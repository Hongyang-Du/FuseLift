"""Per-position statistics of the lifted decoder state for stage1.fuselift.RAEFuseLift.

  mean / var : per-(channel, position) moments of the h_k patch tokens, shape [C, H, W]
  mean_cls   : dataset mean of the decoder CLS token at depth k, shape [1, 1, C]

  torchrun --standalone --nproc_per_node=1 src/compute_fuselift_stats.py \
      --config configs/stage2/training/fuselift-h0-raev2k7-ditxl.yaml \
      --num-samples 50000 --batch 64 --out checkpoints/fuselift/k7/h0_stats_raev2k7.pt
"""
import argparse
import dataclasses
from pathlib import Path

import torch
from omegaconf import OmegaConf

from configs.stage2 import Stage2Config
from data import prepare_imagenet_dataloader
from utils.dist_utils import setup_distributed
from utils.model_utils import instantiate_from_config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--num-samples", type=int, default=50000)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--out", required=True)
    ap.add_argument("opts", nargs="*", help="Config overrides")
    args = ap.parse_args()

    if args.num_samples < 1 or args.batch < 1:
        ap.error("--num-samples and --batch must be positive")
    rank, world_size, device = setup_distributed()
    if world_size != 1:
        raise ValueError("Statistics are computed on one rank; use torchrun --nproc_per_node=1")
    config: Stage2Config = OmegaConf.to_object(
        OmegaConf.merge(OmegaConf.structured(Stage2Config), OmegaConf.load(args.config), OmegaConf.from_dotlist(args.opts)))
    config.stage_1.params["lift_stats_path"] = None      # raw lifted state

    torch.manual_seed(config.training.global_seed)
    rae = instantiate_from_config(config.stage_1).to(device).eval()

    loader = prepare_imagenet_dataloader(
        config=dataclasses.asdict(config.dataset),
        image_size=config.training.image_size,
        batch_size=args.batch,
        num_workers=config.training.num_workers,
        rank=rank, world_size=world_size,
        transform=None,
    )

    s = ss = s_cls = None
    seen = 0
    for images, _ in loader:
        images = images[:args.num_samples - seen].to(device)
        h = rae.lift(images).double()                     # [B, N + 1, C]
        if s is None:
            s = torch.zeros_like(h[0, 1:])
            ss = torch.zeros_like(h[0, 1:])
            s_cls = torch.zeros_like(h[0, 0])
        s += h[:, 1:].sum(0); ss += (h[:, 1:] ** 2).sum(0); s_cls += h[:, 0].sum(0)
        seen += h.shape[0]
        if seen % (args.batch * 20) == 0:
            print(f"  {seen}/{args.num_samples}", flush=True)
        if seen >= args.num_samples:
            break

    if seen != args.num_samples:
        raise ValueError(f"Requested {args.num_samples} images, but loader supplied {seen}")

    n, c = s.shape
    side = int(n ** 0.5)
    mean = s / seen
    var = (ss / seen - mean * mean).clamp_min(0)
    out = {
        "mean": mean.view(side, side, c).permute(2, 0, 1).contiguous().float().cpu(),
        "var": var.view(side, side, c).permute(2, 0, 1).contiguous().float().cpu(),
        "mean_cls": (s_cls / seen).view(1, 1, c).float().cpu(),
        "num_samples": seen,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save(out, args.out)
    print(f"saved -> {args.out}  | mean {tuple(out['mean'].shape)} var range "
          f"[{out['var'].min():.4f}, {out['var'].max():.4f}] ({seen} images)")


if __name__ == "__main__":
    main()
