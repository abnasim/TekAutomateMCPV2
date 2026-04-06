# Check structure of large scope files
$file = "MSO_DPO_5k_7k_70K.json"

try {
    $data = Get-Content $file -Raw | ConvertFrom-Json
    Write-Host "File structure for $file`:"
    
    if ($data -is [array]) {
        Write-Host "Top level is array with $($data.Length) items"
        if ($data.Length -gt 0) {
            Write-Host "First item type: $($data[0].GetType().Name)"
            if ($data[0].groups) {
                $commandCount = 0
                foreach ($group in $data[0].groups.PSObject.Properties) {
                    if ($group.Value.commands) {
                        $commandCount += $group.Value.commands.Count
                    }
                }
                Write-Host "Commands in first item: $commandCount"
            }
        }
    } else {
        Write-Host "Top level is object with properties:"
        $data.PSObject.Properties | ForEach-Object { Write-Host "  $($_.Name)" }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
