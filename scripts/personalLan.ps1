# personalLan.ps1 —— M10 AI 模具 个人版 多端(局域网)一键入口（随插件包发布 v0.1.4+）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File personalLan.ps1 [start|stop|status|autostart|unautostart] [-Port 3081] [-IP <本机局域网IP>] [-HostRoot <宿主目录>]
# 前置: 本机已安装 Node.js(>=22) 与 DeepSeek Harness Web 形态宿主目录（含 apps\cli\src\bin.ts 与 node_modules）；
#       插件已通过桌面 App「插件管理」粘贴仓库地址安装（脚本会自动复用其安装副本）。
# start 成功后自动落盘授权文件 %USERPROFILE%\.dsh\profiles\personal\lan-instance.json，
# 插件设置页据此自动生成手机可扫二维码（免登录，含 boot token）。
param(
  [ValidateSet('start','stop','status','autostart','unautostart')][string]$Action = 'status',
  [int]$Port = 3081,
  [string]$IP = '',
  [string]$HostRoot = ''
)
$ErrorActionPreference = 'Stop'

$profDir = Join-Path $env:USERPROFILE '.dsh\profiles\personal'
$grantFile = Join-Path $profDir 'lan-instance.json'
$log = Join-Path $profDir 'lan-instance.log'
$errLog = Join-Path $profDir 'lan-instance.err.log'

function Find-LanIP {
  $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notmatch '^198\.(18|19)\.' -and $_.PrefixOrigin -ne 'WellKnown' }
  $routeIps = @()
  $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric
  foreach ($r in $routes) {
    $a = Get-NetIPAddress -InterfaceIndex $r.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
      Select-Object -First 1
    if ($a) { $routeIps += $a.IPAddress }
  }
  $pool = @($routeIps + @($all | ForEach-Object { $_.IPAddress })) | Where-Object { $_ } | Select-Object -Unique
  $wifi = $pool | Where-Object { $_ -match '^192\.168\.' } | Select-Object -First 1
  if ($wifi) { return $wifi }
  $priv = $pool | Where-Object { $_ -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' } | Select-Object -First 1
  if ($priv) { return $priv }
  $first = $pool | Select-Object -First 1
  if ($first) { return $first }
  return ''
}
function Test-HostRoot($c) {
  $c -and (Test-Path (Join-Path $c 'apps\cli\src\bin.ts')) -and (Test-Path (Join-Path $c 'node_modules'))
}
function Find-HostRoot {
  if (Test-HostRoot $HostRoot) { return $HostRoot }
  if (Test-HostRoot $env:DSH_HOST_ROOT) { return $env:DSH_HOST_ROOT }
  # 常见位置：各盘符根 DeepSeek 目录 + 用户目录下 DeepSeek（不硬编码单一盘符）
  foreach ($d in @('C:','D:','E:','F:')) {
    if (Test-HostRoot (Join-Path $d 'DeepSeek')) { return (Join-Path $d 'DeepSeek') }
  }
  if (Test-HostRoot (Join-Path $env:USERPROFILE 'DeepSeek')) { return (Join-Path $env:USERPROFILE 'DeepSeek') }
  return ''
}
function Find-Node {
  $g = Get-Command node -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  $pf = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $pf) { return $pf }
  return ''
}
function Get-Listener {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1 | ForEach-Object {
      $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      if ($p) { [pscustomobject]@{ Pid = $p.Id; Name = $p.ProcessName; Addr = "$($_.LocalAddress):$($_.LocalPort)" } }
    }
}
# 在各 profile 的 node_modules 里找已安装的插件物理目录（贴 GitHub 地址安装即在此）
function Find-PluginDir {
  $roots = Get-ChildItem (Join-Path $env:USERPROFILE '.dsh\profiles') -Directory -ErrorAction SilentlyContinue
  foreach ($r in $roots) {
    $c = Join-Path $r.FullName 'node_modules\dsh-plugin-m10-mold-personal'
    if (Test-Path (Join-Path $c 'server\index.js')) { return $c }
  }
  return ''
}
# personal profile 自动初始化：缺 package.json 或缺插件依赖/bundles 项时补齐（宿主冷启动自行完成安装链接）
function Ensure-PersonalProfile {
  $plugin = Find-PluginDir
  if (-not $plugin) { return $false }
  if (-not (Test-Path $profDir)) { New-Item -ItemType Directory -Path $profDir -Force | Out-Null }
  $pf = Join-Path $profDir 'package.json'
  $link = 'link:' + ($plugin -replace '\\','/')
  $pj = $null
  if (Test-Path $pf) { try { $pj = Get-Content $pf -Raw | ConvertFrom-Json } catch { $pj = $null } }
  # 已配好（依赖 link + bundles 项都在）则免写，不碰现有文件
  if ($pj -and $pj.dependencies.'dsh-plugin-m10-mold-personal' -and (@($pj.dsh.profile.bundles) -contains 'dsh-plugin-m10-mold-personal')) { return $true }
  if (-not $pj) {
    $pj = [pscustomobject]@{
      name = 'dsh-profile-personal'; private = $true
      dependencies = [pscustomobject]@{ 'dsh-plugin-m10-mold-personal' = $link }
      dsh = [pscustomobject]@{ profile = [pscustomobject]@{ bundles = @('@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-plugin-m10-mold-personal') } }
    }
  } else {
    if (-not $pj.dependencies) { $pj | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
    if (-not $pj.dependencies.'dsh-plugin-m10-mold-personal') {
      $pj.dependencies | Add-Member -NotePropertyName 'dsh-plugin-m10-mold-personal' -NotePropertyValue $link -Force
    }
    if (-not $pj.dsh -or -not $pj.dsh.profile -or -not $pj.dsh.profile.bundles) {
      $pj | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{ profile = [pscustomobject]@{ bundles = @('@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-plugin-m10-mold-personal') } }) -Force
    } elseif (-not (@($pj.dsh.profile.bundles) -contains 'dsh-plugin-m10-mold-personal')) {
      $pj.dsh.profile.bundles = @($pj.dsh.profile.bundles) + 'dsh-plugin-m10-mold-personal'
    }
  }
  [IO.File]::WriteAllText($pf, ($pj | ConvertTo-Json -Depth 8))
  return $true
}
function Write-GrantFile($lanIp, $procId, $tok) {
  if (-not (Test-Path $profDir)) { New-Item -ItemType Directory -Path $profDir -Force | Out-Null }
  $obj = [ordered]@{ ip = $lanIp; port = $Port; lanUrl = "http://${lanIp}:${Port}"; token = $tok; pid = $procId; startedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
  # .NET WriteAllText 防 PS5 Set-Content 的 BOM（JSON.parse 遇 BOM 必炸）
  [IO.File]::WriteAllText($grantFile, ($obj | ConvertTo-Json -Compress))
}
function Get-TokenFromLog {
  if (-not (Test-Path $log)) { return $null }
  $ms = [regex]::Matches((Get-Content $log -Raw), 'token=([A-Za-z0-9_\-]+)')
  if ($ms.Count -gt 0) { return $ms[$ms.Count-1].Groups[1].Value }
  return $null
}
function Ensure-Firewall($nodeExe) {
  $target = $nodeExe.ToLower()
  foreach ($r in (Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue)) {
    $f = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
    if ($f -and $f.Program) {
      $prog = ($f.Program -replace '%ProgramFiles%', $env:ProgramFiles).ToLower()
      if ($prog -eq $target) { return "OK (rule $($r.Name))" }
    }
  }
  try {
    New-NetFirewallRule -DisplayName 'DSH Personal LAN (node.exe inbound)' -Direction Inbound -Action Allow -Program $nodeExe -Profile Any | Out-Null
    return 'CREATED'
  } catch { return 'MISSING-RUN-AS-ADMIN (以管理员运行一次本脚本即可长期放行)' }
}

switch ($Action) {
  'start' {
    if (-not $IP) { $IP = Find-LanIP }
    $cur = Get-Listener
    if ($cur) {
      $curIp = ($cur.Addr.Split(':'))[0]
      if ($curIp -eq $IP) { Write-Output "ALREADY-RUNNING PID=$($cur.Pid) ($($cur.Addr))"; break }
      Write-Output "STALE-IP: 实例 PID=$($cur.Pid) 仍绑 $curIp，当前局域网 IP 为 $IP（疑似切换网络），正在重启实例…"
      if ($cur.Name -ne 'node') { Write-Output "REFUSED: PID $($cur.Pid) 是 $($cur.Name) 而非 node，无法自动重启，请手动处理"; break }
      Stop-Process -Id $cur.Pid -Force
      Start-Sleep -Seconds 2
    }
    $root = Find-HostRoot
    if (-not $root) { Write-Output 'FAIL: 未找到 DeepSeek Harness 宿主目录（需含 apps\cli\src\bin.ts 与 node_modules）。用 -HostRoot <路径> 指定；没有宿主目录时请从主机电脑整体复制（见发布仓 README「多端/当主机」）。'; break }
    $node = Find-Node
    if (-not $node) { Write-Output 'FAIL: 未找到 node.exe，请先安装 Node.js (>=22)'; break }
    if (-not (Ensure-PersonalProfile)) { Write-Output 'FAIL: 未找到已安装的个人版插件副本。请先在桌面 App 插件管理粘贴仓库地址安装（地址见发布仓 README），再运行本脚本。'; break }
    if (-not $IP) { $IP = Find-LanIP }
    if (-not $IP) { Write-Output 'FAIL: 未探测到局域网 IPv4，请用 -IP <本机局域网IP> 指定'; break }
    $argList = @('--import','tsx/esm','apps/cli/src/bin.ts','--profile','personal','--no-open','--host',$IP,'--port',"$Port",'--trusted-host',"${IP}:${Port}")
    $p = Start-Process -FilePath $node -ArgumentList $argList -WorkingDirectory $root -RedirectStandardOutput $log -RedirectStandardError $errLog -PassThru
    Write-Output "STARTED_PID=$($p.Id)"
    $l = $null
    for ($i = 1; $i -le 45; $i++) {
      Start-Sleep -Seconds 1
      $l = Get-Listener
      if ($l -and $l.Addr -eq "${IP}:${Port}") { Write-Output "LISTEN OK PID=$($l.Pid) @ ${IP}:${Port} (iter $i)"; break }
    }
    if (-not $l) { Write-Output "START FAILED: 45s 内未监听，查看 $errLog"; break }
    $tok = $null
    for ($i = 1; $i -le 10 -and -not $tok; $i++) { $tok = Get-TokenFromLog; if (-not $tok) { Start-Sleep -Seconds 1 } }
    if ($tok) { Write-GrantFile $IP $p.Id $tok; Write-Output "GRANT_FILE=$grantFile" } else { Write-Output 'GRANT-FILE=FAILED (token not found in log)' }
    $fw = Ensure-Firewall $node
    Write-Output "FIREWALL: $fw"
    Write-Output "ACCESS: http://${IP}:${Port}/?token=$tok"
    Write-Output "手机/其它设备(同一路由器): 浏览器打开 http://${IP}:${Port} ，或在桌面 App 设置页扫自动生成的二维码"
  }
  'stop' {
    $l = Get-Listener
    if (-not $l) { Write-Output 'NOT-RUNNING'; break }
    if ($l.Name -ne 'node') { Write-Output "REFUSED: PID $($l.Pid) 是 $($l.Name) 而非 node，不误杀，请手动处理"; break }
    Stop-Process -Id $l.Pid -Force
    Write-Output "STOPPED PID=$($l.Pid)"
  }
  'status' {
    $l = Get-Listener
    if ($l) {
      Write-Output "RUNNING PID=$($l.Pid) NAME=$($l.Name) ADDR=$($l.Addr)"
      $tok = Get-TokenFromLog
      if ($tok) { $a = ($l.Addr.Split(':'))[0]; Write-Output "BOOT-URL(last): http://${a}:$Port/?token=$tok" }
      if (Test-Path $grantFile) { Write-Output "GRANT-FILE: EXISTS $grantFile" } else { Write-Output 'GRANT-FILE: MISSING (QR will lack login token)' }
    } else { Write-Output "NOT-RUNNING (port $Port 无监听)" }
  }
  'autostart' {
    # 登录时自动拉起局域网实例（start 会同步重写授权文件，二维码自动恢复可扫）
    $self = (Get-Item $PSCommandPath).FullName
    $tr = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$self`" start"
    schtasks /create /tn 'DSH-Personal-LAN' /tr $tr /sc onlogon /f | Out-String | Write-Output
  }
  'unautostart' {
    schtasks /delete /tn 'DSH-Personal-LAN' /f | Out-String | Write-Output
  }
}
