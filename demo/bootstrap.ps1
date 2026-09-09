. "$PSScriptRoot\_common.ps1"

Wait-N8n | Out-Null
Initialize-Owner

$weatherPath = Join-Path $DemoDir 'workflows\01-lookup-weather.json'
$orderPath = Join-Path $DemoDir 'workflows\02-lookup-order.json'
$webhookPath = Join-Path $DemoDir 'workflows\03-webhook-orchestrator.json'
$agentPath = Join-Path $DemoDir 'workflows\04-chat-agent.json'

Write-Host 'Importing L1 lookup workflows...'
$weather = Import-DemoWorkflow -Path $weatherPath
$order = Import-DemoWorkflow -Path $orderPath
Activate-DemoWorkflow -Workflow $weather
Activate-DemoWorkflow -Workflow $order

Write-Host "Weather workflow id: $($weather.id)"
Write-Host "Order workflow id:   $($order.id)"

Write-Host 'Importing webhook orchestrator...'
$webhookRaw = Get-Content -Raw -Path $webhookPath
$webhookRaw = $webhookRaw.Replace('WEATHER_WORKFLOW_ID', $weather.id)
$tmpWebhook = Join-Path $env:TEMP 'n8n-demo-webhook.json'
Set-Content -Path $tmpWebhook -Value $webhookRaw -Encoding utf8
$webhook = Import-DemoWorkflow -Path $tmpWebhook
Activate-DemoWorkflow -Workflow $webhook

Write-Host "POST $BaseUrl/webhook/demo-lookup"
$lookup = Invoke-RestMethod -Method POST -Uri "$BaseUrl/webhook/demo-lookup" -ContentType 'application/json' -Body '{"city":"Shanghai"}'
$lookup | ConvertTo-Json -Depth 8
if (-not $lookup.city -and -not $lookup[0].city) {
	Write-Warning 'Webhook responded but city field was not found. Check executions in the UI.'
}

Write-Host 'Listing recent executions...'
$execs = Get-Payload (Invoke-N8nJson -Method GET -Url "$Rest/executions?limit=10")
$execList = @()
if ($execs.results) { $execList = $execs.results }
elseif ($execs.data) { $execList = $execs.data }
elseif ($execs -is [System.Array]) { $execList = $execs }
$execList | Select-Object -First 6 id, workflowId, status, finished, mode | Format-Table | Out-String | Write-Host

$openaiKey = $env:OPENAI_API_KEY
if (-not $openaiKey) {
	Write-Host 'OPENAI_API_KEY is not set. Importing chat agent with a placeholder credential.'
	Write-Host 'Set OPENAI_API_KEY and re-run this script (or add the credential in the UI) to chat with the agent.'
	$openaiKey = 'sk-demo-placeholder-replace-me'
}

Write-Host 'Creating OpenAI credential...'
$cred = Get-Payload (Invoke-N8nJson -Method POST -Url "$Rest/credentials" -Body @{
		name = 'Demo OpenAI'
		type = 'openAiApi'
		data = @{
			apiKey = $openaiKey
			url    = 'https://api.openai.com/v1'
		}
	})

Write-Host 'Importing L2 chat agent...'
$agentRaw = Get-Content -Raw -Path $agentPath
$agentRaw = $agentRaw.Replace('WEATHER_WORKFLOW_ID', $weather.id)
$agentRaw = $agentRaw.Replace('ORDER_WORKFLOW_ID', $order.id)
$agentRaw = $agentRaw.Replace('OPENAI_CREDENTIAL_ID', $cred.id)
$tmpAgent = Join-Path $env:TEMP 'n8n-demo-agent.json'
Set-Content -Path $tmpAgent -Value $agentRaw -Encoding utf8
$agent = Import-DemoWorkflow -Path $tmpAgent

$statePath = Join-Path $DemoDir 'imported-ids.json'
@{
	weatherWorkflowId = $weather.id
	orderWorkflowId   = $order.id
	webhookWorkflowId = $webhook.id
	agentWorkflowId   = $agent.id
	openaiCredentialId = $cred.id
	editor            = "$BaseUrl/workflow/$($agent.id)"
	webhook           = "$BaseUrl/webhook/demo-lookup"
} | ConvertTo-Json | Set-Content -Path $statePath -Encoding utf8

Write-Host ''
Write-Host 'Demo import complete.'
Write-Host "  Editor:  $BaseUrl"
Write-Host "  Login:   $OwnerEmail  /  $OwnerPassword"
Write-Host "  Weather: $BaseUrl/workflow/$($weather.id)"
Write-Host "  Webhook: $BaseUrl/webhook/demo-lookup"
Write-Host "  Agent:   $BaseUrl/workflow/$($agent.id)"
Write-Host "  Ids:     $statePath"
Write-Host ''
Write-Host 'Open the agent workflow, click Chat, and ask: What is the weather in Shanghai?'
