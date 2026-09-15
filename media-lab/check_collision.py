import sqlite3
db = sqlite3.connect('/Users/vibex/.hermes/kanban.db')
db.row_factory = sqlite3.Row
for tid in ('t_8ba7b48b','t_77fd2c46','t_718533aa','t_1a6d2ee3'):
    try:
        r = db.execute("SELECT title,status,assignee,current_run_id FROM tasks WHERE id=?",(tid,)).fetchone()
        if r:
            print(tid, "|", r['status'], "|", r['assignee'], "|", (r['title'] or '')[:90])
    except Exception as e:
        print(tid, "err", e)
# recent comments on collision task
try:
    for c in db.execute("SELECT body FROM task_comments WHERE task_id='t_8ba7b48b' ORDER BY created_at DESC LIMIT 3").fetchall():
        print("C8:", (c['body'] or '')[:300].replace(chr(10),' '))
except Exception as e:
    print("comments err", e)