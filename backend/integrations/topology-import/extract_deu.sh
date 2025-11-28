#!/bin/sh

API_BASE=${API_BASE:-http://localhost:3000/api/v1}

python3 era_ops_export-V1.0.py \
  --country DEU \
  --api-base "$API_BASE" \
  --page-size 1500 --parallel 5 --timeout 120 --retries 7 \
  --normalize-prefix DE --normalize-fillchar "0"

python3 era_sols_export-v1.0.py \
  --country DEU \
  --api-base "$API_BASE" \
  --sol-prefixes 0,1,2,3,4,5,6,7,8,9,A,B,C,D,E,F \
  --limit-sols 0 \
  --page-size 1500 --min-page-size 300 \
  --timeout 90 --retries 7 \
  --batch-endpoints 120 --min-batch-endpoints 40 \
  --batch-meta 80 --min-batch-meta 10 \
  --batch-opids 120 --min-batch-opids 40 \
  --batch-track-dirs 120 --min-batch-track-dirs 40 \
  --batch-track-prop 80 --min-batch-track-prop 30 \
  --batch-labels 20 --min-batch-labels 5 \
  --skip-on-timeout \
  --normalize-prefix DE --normalize-fillchar "0"
