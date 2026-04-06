# Count commands in scope files
$scopeFiles = @("MSO_DPO_5k_7k_70K.json", "mso_2_4_5_6_7.json", "rsa.json")

foreach ($file in $scopeFiles) {
    if (Test-Path $file) {
        try {
            Write-Host "Analyzing $file`:"
            $data = Get-Content $file -Raw | ConvertFrom-Json
            $commandCount = 0
            $groupCount = 0
            
            if ($data.groups) {
                $groupCount = $data.groups.PSObject.Properties.Count
                foreach ($group in $data.groups.PSObject.Properties) {
                    if ($group.Value.commands) {
                        $cmdCount = $group.Value.commands.Count
                        $commandCount += $cmdCount
                        Write-Host "  $($group.Name): $cmdCount commands"
                    }
                }
            }
            
            Write-Host "Total: $commandCount commands in $groupCount groups`n"
        } catch {
            Write-Host "Error reading $file`: $($_.Exception.Message)`n"
        }
    } else {
        Write-Host "$file`: Not found`n"
    }
}
