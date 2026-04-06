# Count actual commands in JSON files
$files = @("afg.json", "awg.json", "smu.json")

foreach ($file in $files) {
    if (Test-Path $file) {
        try {
            $data = Get-Content $file -Raw | ConvertFrom-Json
            $commandCount = 0
            
            if ($data.groups) {
                foreach ($group in $data.groups.PSObject.Properties) {
                    if ($group.Value.commands) {
                        $commandCount += $group.Value.commands.Count
                    }
                }
            }
            
            Write-Host "$file`: $commandCount commands"
        } catch {
            Write-Host "$file`: Error reading - $($_.Exception.Message)"
        }
    } else {
        Write-Host "$file`: Not found"
    }
}
