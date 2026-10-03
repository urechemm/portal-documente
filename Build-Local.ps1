cd "C:\Users\Mihai\.codex\My Projects\Portal documente"

$nodePath = "C:\Users\Mihai\.codex\My Projects\Confirmari sold\tools\node-v22.22.0-win-x64"
$env:Path = "$nodePath;$env:Path"

npm.cmd run dev
