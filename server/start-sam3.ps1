$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:SAM_MODEL = 'sam3'
& "$PSScriptRoot\.venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8765
exit $LASTEXITCODE
