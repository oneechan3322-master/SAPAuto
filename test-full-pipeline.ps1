# SAPAuto V8 - Full Pipeline Test
# Account: Thenile14
# Test: Portal Scan → Processing → Notification

## Step 1: Verify Services
Write-Host '
🔍 Step 1: Checking PM2 Services...' -ForegroundColor Cyan
$services = pm2 jlist | ConvertFrom-Json
$online = ($services | Where-Object { $_.pm2_env.status -eq 'online' }).Count
Write-Host \"✅ Services: $online/6 online\"

## Step 2: Queue Manual Scan
Write-Host '
🔍 Step 2: Queueing scan for Thenile14...' -ForegroundColor Cyan
node -e \"const db=require('better-sqlite3')('./data/sapauto.db'); const ts=new Date().toISOString(); const id='scan-test-'+Date.now(); db.prepare('INSERT INTO commands(id,type,status,payload,created_at,requested_by) VALUES(?,?,?,?,?,?)').run(id,'portal_scan','queued',JSON.stringify({account:'Thenile14'}),ts,'test'); console.log('✅ Scan queued:', id); db.close();\"

## Step 3: Monitor Execution
Write-Host '
🔍 Step 3: Monitoring scan execution...' -ForegroundColor Cyan
Write-Host 'Waiting for harness to pick up the command...'
Start-Sleep -Seconds 10

## Step 4: Check Results
Write-Host '
🔍 Step 4: Checking scan results...' -ForegroundColor Cyan
node -e \"const db=require('better-sqlite3')('./data/sapauto.db'); const cmd=db.prepare('SELECT status,result FROM commands WHERE type=? AND requested_by=? ORDER BY created_at DESC LIMIT 1').get('portal_scan','test'); console.log('Status:', cmd?.status || 'not found'); if(cmd?.result) console.log('Result:', cmd.result.slice(0,100)); db.close();\"

Write-Host '
✅ Full pipeline test complete!' -ForegroundColor Green
