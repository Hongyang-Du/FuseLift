"""FuseLift: run the stage-2 DiT on a lifted decoder state instead of the encoder latent.

The usual RAE generator diffuses the fused encoder latent z [B, 1024, 16, 16]. FuseLift
moves that boundary into the frozen pixel decoder and diffuses

    h_k = decoder state after `block_depth` = k transformer blocks      [B, 1152, 16, 16]

With k = 0 (the released checkpoint) h_0 is the decoder's linear input embedding of z
plus its position embedding, so the lift is a fixed affine map of the encoder latent.
The remaining decoder blocks k..N-1 turn a sampled h_k into pixels.

    image -> frozen encoder -> layer fusion -> z -> decoder_embed (+pos) -> block[0..k-1] -> h_k
    DiT target  = per-position standardized h_k patch tokens (CLS dropped)
    decode(h_k) = [dataset-mean CLS, h_k] -> block[k..N-1] -> norm -> pred -> unpatchify

The decoder CLS token cannot ride along in the square token grid, so decoding substitutes
its dataset mean (`mean_cls`). `lift_stats_path` holds `mean` / `var` of shape [C, H, W]
and `mean_cls` of shape [1, 1, C]; see src/compute_fuselift_stats.py.
"""
from math import sqrt
from typing import Optional

import torch

from .rae_variants import RAECombine


class RAEFuseLift(RAECombine):
    def __init__(self, lift_stats_path: Optional[str] = None, block_depth: int = 0, **kwargs):
        kwargs.setdefault("drop", False)          # deterministic full fusion -> deterministic target
        if kwargs.get("normalization_stat_path") is not None:
            raise ValueError("RAEFuseLift standardizes h_k with lift_stats_path, not normalization_stat_path")
        super().__init__(**kwargs)
        num_blocks = len(self.decoder.decoder_layers)
        if not 0 <= block_depth < num_blocks:
            raise ValueError(f"block_depth must lie in 0..{num_blocks - 1}")
        self.block_depth = block_depth
        width = self.decoder.decoder_pred.in_features
        stats = torch.load(lift_stats_path, map_location="cpu", weights_only=True) if lift_stats_path else {}
        if stats and not {"mean", "var", "mean_cls"} <= stats.keys():
            raise ValueError(f"{lift_stats_path} must contain mean, var and mean_cls")
        self.has_lift_stats = bool(stats)
        self.register_buffer("lift_mean", stats["mean"].float() if stats else torch.zeros(width, 1, 1))
        self.register_buffer("lift_var", stats["var"].float() if stats else torch.ones(width, 1, 1))
        self.register_buffer("mean_cls", stats["mean_cls"].float() if stats else torch.zeros(1, 1, width))
        if stats:
            print(f"RAEFuseLift: h_{block_depth} statistics from {lift_stats_path}")

    @torch.no_grad()
    def lift(self, x: torch.Tensor) -> torch.Tensor:
        """Images -> raw h_k including the decoder CLS token, [B, N + 1, C]."""
        z = self.combine(self._layer_tokens(self._imgs_to_norm(x)))
        d = self.decoder
        h = d.interpolate_latent(d.decoder_embed(z))
        h = torch.cat([d.trainable_cls_token.expand(h.shape[0], -1, -1), h], dim=1) + d.decoder_pos_embed
        for layer in d.decoder_layers[:self.block_depth]:
            h = layer(h, head_mask=None)[0]
        return h

    @torch.no_grad()
    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Images -> standardized h_k patch tokens [B, C, H, W], the DiT target."""
        patches = self.lift(x)[:, 1:]
        b, n, c = patches.shape
        side = int(sqrt(n))
        h = patches.transpose(1, 2).reshape(b, c, side, side)
        return (h - self.lift_mean) / torch.sqrt(self.lift_var + self.eps)

    @torch.no_grad()
    def encode_cond_target(self, x: torch.Tensor):
        """Input and target coincide: the lifted state is a deterministic full-fusion readout."""
        if not self.has_lift_stats:
            raise RuntimeError("Training requires lift_stats_path")
        h = self.encode(x)
        return h, h

    def decode(self, h: torch.Tensor) -> torch.Tensor:
        """Standardized h_k [B, C, H, W] -> images in [0, 1] through decoder blocks k..N-1."""
        if not self.has_lift_stats:
            raise RuntimeError("Decoding requires lift_stats_path")
        h = h * torch.sqrt(self.lift_var + self.eps) + self.lift_mean
        b, c, height, width = h.shape
        tokens = h.reshape(b, c, height * width).transpose(1, 2)
        d = self.decoder
        tokens = torch.cat([self.mean_cls.to(tokens.dtype).expand(b, -1, -1), tokens], dim=1)
        for layer in d.decoder_layers[self.block_depth:]:
            tokens = layer(tokens, head_mask=None)[0]
        logits = d.decoder_pred(d.decoder_norm(tokens))[:, 1:]
        return self.denormalize_output(d.unpatchify(logits))
