#!/usr/bin/env bash
# Teste les modeles NVIDIA NIM gratuits : latence + validite du JSON renvoye.
# Usage : NK=nvapi-... bash tools/test-nvidia-models.sh
NK="${NK:?cle NVIDIA manquante}"
URL=https://integrate.api.nvidia.com/v1/chat/completions
PROMPT='Analyse technique BTC/USD H1. Reponds UNIQUEMENT un JSON: {"biais":"haussier|baissier|neutre","confiance":0-100,"raison":"..."}'

MODELS="
deepseek-ai/deepseek-v4.1-flash
z-ai/glm-5.3-flash
openai/gpt-oss-20b
minimaxai/minimax-m3.1-flash
meta/muse-glimmer-30b
mistralai/mistral-large-4-1t-a52b
mistralai/mistral-large-2-instruct
nvidia/nemotron-3.5-lightning-30b-a3b
nvidia/nemotron-nano-3-30b-a3b
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-3-super-120b-a12b
nvidia/nemotron-3-ultra-550b-a55b
nvidia/nemotron-3.5-super-vl-120b-a12b
stepfun-ai/step-5-preview
google/gemma-4-31b-it
moonshotai/kimi-k2.6
"

for m in $MODELS; do
  [ -z "$m" ] && continue
  s=$(date +%s%3N)
  body=$(MODEL="$m" PROMPT="$PROMPT" node -e 'console.log(JSON.stringify({model:process.env.MODEL,messages:[{role:"user",content:process.env.PROMPT}],max_tokens:400,temperature:0}))')
  r=$(curl -s -m 90 "$URL" -H "Authorization: Bearer $NK" -H "Content-Type: application/json" -d "$body")
  e=$(date +%s%3N)
  printf '%-48s %6sms  ' "$m" "$((e-s))"
  printf '%s' "$r" | node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{
  let d; try{ d=JSON.parse(raw) }catch(e){ console.log("PARSE_FAIL "+raw.slice(0,120).replace(/\n/g," ")); return }
  if(d.detail||d.error||d.status){ console.log("ERREUR "+String(d.detail||d.error).slice(0,100)); return }
  const ch=(d.choices||[{}])[0], msg=ch.message||{}, u=d.usage||{};
  const c=msg.content, ok=(c&&c.trim().startsWith("{"))?"JSON_OK":"NO_JSON";
  console.log(`${ok} finish=${ch.finish_reason} tok=${u.completion_tokens} content=${JSON.stringify(String(c).slice(0,90))}`);
})'
done
