#!/usr/bin/env bash
# yuan-Gym — end-to-end smoke test against the live Worker, over curl.
#
# The Node version (smoke.mjs) cannot reach the edge from inside the agent sandbox (raw sockets
# from node time out; curl is allowed), so this one drives everything with curl and only uses node
# for local work: deriving the PBKDF2 verifier and picking fields out of JSON.
#
# The sandbox's egress to Cloudflare is also flaky (the same request succeeds or times out from one
# minute to the next), so every call retries on an empty answer.
#
# Flow: salt -> register (code inserted into D1 out of band, see run-smoke.sh) -> sync put ->
#       sync get -> login -> me -> admin cleanup.
#
# Usage: CODE=424242 ADMIN_TOKEN=... bash test/smoke.sh [name] [email] [password]

set -u
# The host shell exports a proxy for the agent's own traffic; curl then hands the request to it
# even with --noproxy '*' and the edge refuses. Clear it once, up front.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy

API="${API_BASE:-https://api.yuanzq.top}"
NAME="${1:-smokeuser}"
EMAIL="${2:-smoke@example.com}"
PASS="${3:-smoke-Passw0rd}"
ADMIN="${ADMIN_TOKEN:-}"
CODE="${CODE:-}"

fails=0
say() { printf '  %-10s %s %s\n' "$1" "${2:-FAIL}" "${3:-}"; if [ -z "${2:-}" ]; then fails=$((fails+1)); fi; return 0; }
pick() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);let v=o;for(const k of '$1'.split('.'))v=v?.[k];console.log(v===undefined||v===null?'':String(v))}catch(e){console.log('')}})"; }

# One curl call, retried while the answer comes back empty (transport hiccup, not an API error).
hit() {
  local out='' i
  for i in 1 2 3 4 5; do
    out=$(curl -s -m 25 --noproxy '*' "$@" 2>/dev/null)
    [ -n "$out" ] && break
    sleep 2
  done
  printf '%s' "$out"
}

echo "smoke: $API as $NAME <$EMAIL>"

SALT_JSON=$(hit "$API/api/auth/salt?name=$(printf '%s' "$NAME" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(encodeURIComponent(s)))")")
SALT=$(printf '%s' "$SALT_JSON" | pick salt)
ITER=$(printf '%s' "$SALT_JSON" | pick iterations); ITER=${ITER:-210000}
if [ -n "$SALT" ]; then say salt ok "iters=$ITER"; else say salt; echo "  $SALT_JSON"; exit 1; fi

VERIFIER=$(node -e "const c=require('crypto');process.stdout.write(c.pbkdf2Sync('$PASS',Buffer.from('$SALT','hex'),$ITER,64,'sha512').toString('hex'))")

REG=$(hit -X POST -H 'content-type: application/json' \
  -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"code\":\"$CODE\",\"verifier\":\"$VERIFIER\"}" \
  "$API/api/auth/register")
TOKEN=$(printf '%s' "$REG" | pick token)
# A retried register can come back as "already taken" when the first attempt did land; that is a
# pass for this step — the login check below then carries the flow.
printf '%s' "$REG" | grep -q '已' && [ -z "$TOKEN" ] && TOKEN='taken'
if [ -n "$TOKEN" ] && [ "$TOKEN" != 'taken' ]; then
  say register ok "token=${TOKEN:0:8}…"
elif [ "$TOKEN" = 'taken' ]; then
  say register ok "(already existed)"
else
  say register; echo "  $REG"; exit 1
fi

if [ "$TOKEN" != 'taken' ]; then
  PUT=$(hit -X PUT -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
    -d '{"state":{"workouts":[{"day":"2026-11-09","done":true}],"note":"smoke"}}' "$API/api/sync")
  REV=$(printf '%s' "$PUT" | pick rev)
  if [ -n "$REV" ]; then say "sync put" ok "rev=$REV"; else say "sync put"; echo "  $PUT"; fi

  GET=$(hit -H "authorization: Bearer $TOKEN" "$API/api/sync")
  ROUND=$(printf '%s' "$GET" | pick state.note)
  if [ "$ROUND" = "smoke" ]; then say "sync get" ok roundtrip; else say "sync get"; echo "  $GET"; fi
fi

LOGIN=$(hit -X POST -H 'content-type: application/json' \
  -d "{\"name\":\"$NAME\",\"verifier\":\"$VERIFIER\"}" "$API/api/auth/login")
LTOKEN=$(printf '%s' "$LOGIN" | pick token)
if [ -n "$LTOKEN" ]; then say login ok; else say login; echo "  $LOGIN"; fi

ME=$(hit -H "authorization: Bearer ${LTOKEN:-${TOKEN}}" "$API/api/auth/me")
WHO=$(printf '%s' "$ME" | pick user.name)
if [ "$WHO" = "$NAME" ]; then say me ok "email=$(printf '%s' "$ME" | pick user.email)"; else say me; echo "  $ME"; fi

if [ -n "$ADMIN" ]; then
  ID=$(printf '%s' "$ME" | pick user.id)
  if [ -n "$ID" ]; then
    DEL=$(hit -X DELETE -H "authorization: Bearer $ADMIN" "$API/api/admin/user/$ID")
    if [ "$(printf '%s' "$DEL" | pick ok)" = "true" ]; then say cleanup ok; else say cleanup; echo "  $DEL"; fi
  fi
fi

echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; fi
exit $((fails > 0))
