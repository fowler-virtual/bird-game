# 追跡解除（初回だけ）— PowerShell

リポジトリルートで、以下を順に実行する（コピペで可）。

```powershell
git rm -r --cached node_modules
git rm -r --cached dist
git rm -r --cached .cursor
git rm -r --cached .vite
git add -A
git status
git commit -m "chore: stop tracking node_modules, dist, .cursor, .vite"
git push
```
