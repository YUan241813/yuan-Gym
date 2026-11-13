#!/usr/bin/env bash
# yuan-Gym — verifies the account flow after the email step was removed.
#
#   register (name + password only)
#   -> me -> sync put/get
#   -> admin resets the password
#   -> the OLD password must now be refused, the NEW one must work
#   -> account deleted
#
# Usage: ADMIN_TOKEN=... bash test/verify-noemail.sh

set -u
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
API="${API_BASE:-https://api.yuanzq.top}"
ADMIN="${ADMIN_TOKEN:-}"
NAME="${1:-tester$$}"
PASS="${2:-first-Passw0rd}"
NEWPASS="${3:-second-Passw0rd}"

fails=0
say() { printf '  %-16s %s %s\n' "$1" "${2:-FAIL}" "${3:-}"; if [ -z "${2:-}" ]; then fails=$((fails+1)); fi; return 0; }
pick() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);let v=o;for(const k of '$1'.split('.'))v=v?.[k];console.log(v===undefined||v===null?'':String(v))}catch(e){console.log('')}})"; }
verifier() { node -e "const c=require('crypto');process.stdout.write(c.pbkdf2Sync(process.argv[1],Buffer.from(process.argv[2],'hex'),210000,64,'sha512').toString('hex'))" "$1" "$2"; }
post() { curl -s -m 25 --noproxy '*' -X POST -H 'content-type: application/json' -d "$2" "$1"; }

echo "verify: $API as $NAME"

SALT=""; for i in 1 2 3 4 5; do SALT=$(curl -s -m 25 --noproxy '*' "$API/api/auth/salt?name=$NAME" | pick salt); [ -n "$SALT" ] && break; sleep 2; done; # salt_retry
[ -n "$SALT" ] && say salt ok || { say salt; exit 1; }

V1=$(verifier "$PASS" "$SALT")
REG=$(post "$API/api/auth/register" "{\"name\":\"$NAME\",\"verifier\":\"$V1\"}")
TOKEN=$(printf '%s' "$REG" | pick token)
if [ -n "$TOKEN" ]; then say "register" ok "no email, token=${TOKEN:0:8}…"; else say register; echo "  $REG"; exit 1; fi

ME=$(curl -s -m 25 --noproxy '*' -H "authorization: Bearer $TOKEN" "$API/api/auth/me")
ID=$(printf '%s' "$ME" | pick user.id)
[ -n "$ID" ] && say me ok "id=$ID" || { say me; echo "  $ME"; }

PUT=$(curl -s -m 25 --noproxy '*' -X PUT -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d '{"state":{"note":"noemail"}}' "$API/api/sync")
[ "$(printf '%s' "$PUT" | pick ok)" = "true" ] && say "sync put" ok "rev=$(printf '%s' "$PUT" | pick rev)" || { say "sync put"; echo "  $PUT"; }

# --- admin reset -----------------------------------------------------------
V2=$(verifier "$NEWPASS" "$SALT")
RST=$(post "$API/api/admin/user/$ID/password?token=$ADMIN" "{\"verifier\":\"$V2\"}")
[ "$(printf '%s' "$RST" | pick ok)" = "true" ] && say "admin reset" ok || { say "admin reset"; echo "  $RST"; }

OLD=$(post "$API/api/auth/login" "{\"name\":\"$NAME\",\"verifier\":\"$V1\"}")
[ "$(printf '%s' "$OLD" | pick ok)" = "false" ] && say "old password" ok "refused, as it should be" || { say "old password"; echo "  $OLD"; }

NEW=$(post "$API/api/auth/login" "{\"name\":\"$NAME\",\"verifier\":\"$V2\"}")
[ -n "$(printf '%s' "$NEW" | pick token)" ] && say "new password" ok || { say "new password"; echo "  $NEW"; }

if [ -n "$ADMIN" ] && [ -n "$ID" ]; then
  DEL=$(curl -s -m 25 --noproxy '*' -X DELETE "$API/api/admin/user/$ID?token=$ADMIN")
  [ "$(printf '%s' "$DEL" | pick ok)" = "true" ] && say cleanup ok || { say cleanup; echo "  $DEL"; }
fi

echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; fi
exit $((fails > 0))
