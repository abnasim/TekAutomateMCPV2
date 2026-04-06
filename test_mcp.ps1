# Test MCP server with basic SCPI questions
$body = @{
    userMessage = "what is the command to setup bus"
    outputMode = "steps_json"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri http://localhost:8787/ai/chat -Method POST -ContentType "application/json" -Body $body
    Write-Host "Response:"
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
