#!/bin/sh
# Live contract test for workbench/server.mjs. Runs against a sandboxed
# config (WORKBENCH_CONFIG) so it never touches the real Application Support.
# Prints PASS/FAIL per check; exits non-zero if anything fails.
set -u

DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
PORT=18794
TOKEN=$(openssl rand -hex 16)
BASE="http://127.0.0.1:$PORT"
AUTH="X-Workbench-Token: $TOKEN"
FAILS=0
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  sleep 1
  rm -rf "$TMP"
}
trap cleanup EXIT

check() { # check <name> <ok:0|1>
  if [ "$2" -eq 0 ]; then echo "PASS  $1"; else echo "FAIL  $1"; FAILS=$((FAILS+1)); fi
}

mkdir -p "$TMP/projects"
cat > "$TMP/workbench.json" <<EOF
{ "enabled": true, "port": $PORT, "token": "$TOKEN", "projectsRoot": "$TMP/projects" }
EOF

echo "== starting server (config: $TMP/workbench.json) =="
WORKBENCH_CONFIG="$TMP/workbench.json" node "$DIR/server.mjs" > "$TMP/server.log" 2>&1 &
SERVER_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.3
  curl -sf -H "$AUTH" "$BASE/status" > /dev/null 2>&1 && break
done

# --- refuse to start without a token -----------------------------------
cat > "$TMP/notoken.json" <<EOF
{ "enabled": true, "port": 8929, "projectsRoot": "$TMP/projects" }
EOF
WORKBENCH_CONFIG="$TMP/notoken.json" node "$DIR/server.mjs" > "$TMP/notoken.log" 2>&1
check "refuses to start without token" $([ $? -ne 0 ] && echo 0 || echo 1)

# --- auth ---------------------------------------------------------------
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/status")
check "401 without token" $([ "$CODE" = "401" ] && echo 0 || echo 1)

CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Workbench-Token: wrongwrongwrong" "$BASE/status")
check "401 with wrong token" $([ "$CODE" = "401" ] && echo 0 || echo 1)

BODY=$(curl -s -H "$AUTH" "$BASE/status")
echo "$BODY" | grep -q '"ok":true' && echo "$BODY" | grep -q '"version":1'
check "/status ok+version" $?

# --- import a static project -------------------------------------------
B64=$(printf 'hi' | base64)
CODE=$(curl -s -o "$TMP/import.out" -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"id":"staticdemo","name":"Static Demo","files":[
        {"path":"index.html","content":"<h1>WB static ok</h1>"},
        {"path":"assets/note.txt","content":"'"$B64"'","encoding":"base64"}]}' \
  "$BASE/projects/import")
[ "$CODE" = "200" ] && [ -f "$TMP/projects/staticdemo/index.html" ] && \
  [ "$(cat "$TMP/projects/staticdemo/assets/note.txt")" = "hi" ]
check "import static project (utf-8 + base64)" $?

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"id":"evil","files":[{"path":"../escape.txt","content":"x"}]}' "$BASE/projects/import")
[ "$CODE" = "400" ] && [ ! -f "$TMP/projects/../escape.txt" ] && [ ! -f "$TMP/escape.txt" ]
check "import rejects ../ traversal" $?

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"id":"evil","files":[{"path":"/tmp/abs.txt","content":"x"}]}' "$BASE/projects/import")
check "import rejects absolute path" $([ "$CODE" = "400" ] && echo 0 || echo 1)

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"id":"evil","files":[{"path":"a\\\\b.txt","content":"x"}]}' "$BASE/projects/import")
check "import rejects backslash path" $([ "$CODE" = "400" ] && echo 0 || echo 1)

# --- files walk ---------------------------------------------------------
BODY=$(curl -s -H "$AUTH" "$BASE/projects/staticdemo/files")
echo "$BODY" | grep -q 'index.html' && echo "$BODY" | grep -q 'assets/note.txt'
check "/projects/:id/files returns tree" $?

# --- exec serve + preview + events -------------------------------------
JOB=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"project":"staticdemo","task":"serve"}' "$BASE/exec" | sed 's/.*"job":"\([^"]*\)".*/\1/')
echo "$JOB" | grep -Eq '^[0-9a-f-]{36}$'; check "exec serve returns job id" $?

STATE=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  STATE=$(curl -s -H "$AUTH" "$BASE/jobs/$JOB" | sed 's/.*"state":"\([^"]*\)".*/\1/')
  [ "$STATE" = "running" ] && break
  sleep 0.3
done
check "serve job reaches 'running'" $([ "$STATE" = "running" ] && echo 0 || echo 1)

BODY=$(curl -s -H "$AUTH" "$BASE/preview/staticdemo/index.html")
echo "$BODY" | grep -q 'WB static ok'
check "preview proxies served index.html" $?

BODY=$(curl -s "$BASE/preview/staticdemo/index.html?wbt=$TOKEN")
echo "$BODY" | grep -q 'WB static ok'
check "preview accepts ?wbt= token" $?

BODY=$(curl -s -H "$AUTH" "$BASE/events?since=0")
echo "$BODY" | grep -q '"type":"dev-up"' && echo "$BODY" | grep -q '"project":"staticdemo"'
check "/events shows dev-up for serve" $?
LASTSEQ=$(echo "$BODY" | sed 's/.*"seq":\([0-9]*\),"events".*/\1/')

BODY=$(curl -s -H "$AUTH" "$BASE/status")
echo "$BODY" | grep -q '"devRunning":true' && echo "$BODY" | grep -q '"devPort":885'
check "/status shows devRunning + port >=8850" $?

# --- npm build project --------------------------------------------------
# JSON-in-JSON quoting is miserable in sh — let node build the import body.
node -e '
  const pkg = JSON.stringify({ name: "nodedemo", version: "1.0.0",
    scripts: { build: "node -e \"console.log(String.fromCharCode(98,117,105,108,116))\"" } });
  process.stdout.write(JSON.stringify({ id: "nodedemo", name: "Node Demo",
    files: [{ path: "package.json", content: pkg }] }));
' > "$TMP/nodedemo-import.json"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d @"$TMP/nodedemo-import.json" "$BASE/projects/import")
check "import package.json project" $([ "$CODE" = "200" ] && echo 0 || echo 1)

JOB=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"project":"nodedemo","task":"build"}' "$BASE/exec" | sed 's/.*"job":"\([^"]*\)".*/\1/')
STATE=""
for i in $(seq 1 40); do
  BODY=$(curl -s -H "$AUTH" "$BASE/jobs/$JOB")
  STATE=$(echo "$BODY" | sed 's/.*"state":"\([^"]*\)".*/\1/')
  [ "$STATE" = "done" ] || [ "$STATE" = "failed" ] && break
  sleep 0.5
done
echo "$BODY" | grep -q '"state":"done"' && echo "$BODY" | grep -q 'built'
check "exec build → done, logTail contains 'built'" $?

BODY=$(curl -s -H "$AUTH" "$BASE/events?since=$LASTSEQ")
echo "$BODY" | grep -q '"type":"job-done"'
check "/events shows job-done for build" $?

# --- typecheck failure path (no tsconfig) ------------------------------
JOB=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"project":"nodedemo","task":"typecheck"}' "$BASE/exec" | sed 's/.*"job":"\([^"]*\)".*/\1/')
sleep 0.5
BODY=$(curl -s -H "$AUTH" "$BASE/jobs/$JOB")
echo "$BODY" | grep -q '"state":"failed"' && echo "$BODY" | grep -q 'tsconfig'
check "typecheck w/o tsconfig fails with clear log" $?

# --- disallowed task ----------------------------------------------------
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"project":"nodedemo","task":"rm -rf /"}' "$BASE/exec")
check "non-allowlisted task rejected (400)" $([ "$CODE" = "400" ] && echo 0 || echo 1)

# --- stop-dev -----------------------------------------------------------
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"project":"staticdemo","task":"stop-dev"}' "$BASE/exec" > /dev/null
sleep 0.5
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/preview/staticdemo/index.html")
BODY=$(curl -s -H "$AUTH" "$BASE/preview/staticdemo/index.html")
[ "$CODE" = "404" ] && echo "$BODY" | grep -q '"ok":false'
check "stop-dev kills serve; preview → JSON 404" $?

# --- shutdown -----------------------------------------------------------
kill -TERM "$SERVER_PID" 2>/dev/null
WAITED=0
while kill -0 "$SERVER_PID" 2>/dev/null && [ "$WAITED" -lt 10 ]; do sleep 0.3; WAITED=$((WAITED+1)); done
kill -0 "$SERVER_PID" 2>/dev/null; ALIVE=$?
check "SIGTERM shuts server down" $([ "$ALIVE" -ne 0 ] && echo 0 || echo 1)
[ "$ALIVE" -ne 0 ] && SERVER_PID=""

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$FAILS CHECK(S) FAILED"; fi
exit "$FAILS"
