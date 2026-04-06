# Simple test for MCP server
$request = @{
    userMessage = "what is the command to add power measurement with power quality"
    outputMode = "steps_json"
    mode = "mcp_only"
    provider = "openai"
    model = "gpt-4o-mini"
    apiKey = "__mcp_only__"
} | ConvertTo-Json

Write-Host "Sending request: $request"

try {
    $response = Invoke-RestMethod -Uri "http://localhost:8787/ai/chat" -Method POST -ContentType "application/json" -Body $request
    Write-Host "SUCCESS - Response:"
    $response | ConvertTo-Json -Depth 5
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
    
    # Try to get more error details
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errorBody = $reader.ReadToEnd()
        Write-Host "Error body: $errorBody"
    }
}
