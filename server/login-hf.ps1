$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\.venv\Scripts\hf.exe" auth login
exit $LASTEXITCODE
