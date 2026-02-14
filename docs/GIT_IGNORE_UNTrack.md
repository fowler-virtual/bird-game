# .gitignore と追跡解除（初回だけ）

`node_modules` / `dist` / Playwright 成果物など、Git で管理しないものを以前コミットしてしまっている場合の追跡解除手順です。**初回のみ**実行すれば十分です。

## 前提

- `.gitignore` に該当パスはすでに書かれていること。
- 物理削除はしません（`--cached` のみでインデックスから外す）。

## 追跡解除（PowerShell）

リポジトリルートで実行します。**追跡されていないパス**は `fatal: pathspec '...' did not match any files` と出るだけなので、その行は無視して次のコマンドを続けてください。

```powershell
git rm -r --cached node_modules
git rm -r --cached dist
git rm -r --cached playwright-report
git rm -r --cached test-results
git rm -r --cached .cursor
git rm -r --cached .vite
git add -A
git status
```

問題なければコミットしてください。

```powershell
git commit -m "chore: stop tracking node_modules, dist, playwright-report, test-results, .cursor, .vite"
```
