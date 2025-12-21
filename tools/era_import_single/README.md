# ERA KG Import – Single File (.nq.xz)

## Setup
```bash
cd tools/era_import_single
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env anpassen (DATABASE_URL, ERA_NQ_XZ)
