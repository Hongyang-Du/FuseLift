This repository builds on the public FuseReg code (https://github.com/Hongyang-Du/FuseReg,
commit b8fb39c), which derives its model, training, and evaluation implementation from RAEv2.
The RAEv2 CC BY-NC 4.0 license and attribution are preserved in LICENSE.

FuseLift adds `src/stage1/fuselift.py`, `src/compute_fuselift_stats.py`, `scripts/eval_npz.py`
and the configs under `configs/stage2/training/`. The remaining files under `src/` are unchanged
FuseReg files.

The decoder and discriminator implementation includes attributed adaptations
from ViT-MAE (Transformers), taming-transformers, and StyleGAN-T. Source comments
retain those attributions. DINOv3 is downloaded from its upstream repository and uses its own
model license. The optional GMuon optimizer is obtained from its upstream repository.

The pixel decoders used by the released checkpoints are the official RAEv2 DINOv3-L decoders
(https://huggingface.co/nyu-visionx/RAEv2-models). This repository does not include encoder
weights or ImageNet images.
