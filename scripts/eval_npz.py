"""gFID / IS / FDr6 of a sample archive with fd_evaluator (ImageNet-256 train reference statistics).

    python scripts/eval_npz.py checkpoints/fuselift/samples/ditxl_h0_raev2k7_ep080_ig178_50k.npz \
        --fid-ref checkpoints/fuselift/reference/imagenet_256_fid_stats.npz

The archive holds `arr_0`, uint8 [N, 256, 256, 3]. Install the evaluator first:
    pip install --no-deps "git+https://github.com/nanovisionx/nanogen-evals.git@19dfb4c2705333eb8b97e454fb354d47d1fe135b#subdirectory=fd_evaluator"
"""
import argparse
import json
import os

import numpy as np
from fd_evaluator import compute_metrics


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("npz")
    ap.add_argument("--metrics", nargs="+", default=["fid", "inception_score", "fdr6"])
    ap.add_argument("--fid-ref", default=None,
                    help="FID reference statistics (.npz with mu, sigma), e.g. "
                         "checkpoints/fuselift/reference/imagenet_256_fid_stats.npz. "
                         "Default: fd_evaluator downloads the same file itself.")
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--out", default=None, help="Optional JSON path for the result")
    args = ap.parse_args()

    images = np.load(args.npz)["arr_0"]
    if images.dtype != np.uint8 or images.ndim != 4 or images.shape[-1] != 3:
        raise ValueError(f"expected uint8 [N, H, W, 3], got {images.dtype} {images.shape}")
    kwargs = {}
    if args.fid_ref:
        # fd_evaluator treats an existing *.npz path as the statistics file and anything else as a catalogue name.
        if not (args.fid_ref.endswith(".npz") and os.path.isfile(args.fid_ref)):
            raise FileNotFoundError(f"--fid-ref must be an existing .npz file, got {args.fid_ref}")
        kwargs["fid_reference"] = os.path.abspath(args.fid_ref)
    result = compute_metrics(images=images, metrics=args.metrics, device=args.device, batch_size=args.batch, **kwargs)
    result = {k: float(v) for k, v in result.items()}
    print(json.dumps(result, indent=2))
    if args.out:
        with open(args.out, "w") as f:
            json.dump({"npz": args.npz, "num_samples": int(images.shape[0]), **result}, f, indent=2)


if __name__ == "__main__":
    main()
