# Count commands in each JSON file
$files = @("MSO_DPO_5k_7k_70K.json", "mso_2_4_5_6_7.json", "rsa.json", "afg.json", "awg.json", "smu.json", "tekexpress.json")

foreach ($file in $files) {
    if (Test-Path $file) {
        try {
            $data = Get-Content $file -Raw | ConvertFrom-Json
            Write-Host "$file`: $($data.Count) commands"
        } catch {
            Write-Host "$file`: Error reading - $($_.Exception.Message)"
        }
    } else {
        Write-Host "$file`: Not found"
    }
}
