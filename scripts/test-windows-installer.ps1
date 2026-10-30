# Exercise a real NSIS installer in a disposable Windows user profile.
param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This test requires Windows.' }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$classes = 'Software\Classes'
$preferences = 'Software\marknext\MarkNext'
$markdown = 'com.marknext.app.Markdown'
$text = 'com.marknext.app.Text'
$other = 'MarkNext.InstallerTest.Other'
$extensions = @('md', 'markdown', 'txt')
$directory = Join-Path $env:TEMP ('MarkNext installer 测试 ' + [guid]::NewGuid())
$iconSource = Join-Path $PSScriptRoot '../src-tauri/icons/markdown.ico'

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -cne $Expected) { throw "$Message`: expected [$Expected], received [$Actual]" }
}
function Read-Value([string]$Path, [string]$Name = '') {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Path)
    if ($null -eq $key) { return $null }
    try { return $key.GetValue($Name, $null) } finally { $key.Dispose() }
}
function Write-Value([string]$Path, [string]$Name, [string]$Value) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Path)
    try { $key.SetValue($Name, $Value) } finally { $key.Dispose() }
}
function Remove-Value([string]$Path, [string]$Name) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Path, $true)
    if ($null -ne $key) {
        try { $key.DeleteValue($Name, $false) } finally { $key.Dispose() }
    }
}
function Run-Setup([string]$Options) {
    # NSIS /D= must be last and unquoted, even for directories with spaces.
    $p = Start-Process -FilePath $Installer -ArgumentList "/S /NS $Options /D=$directory" -Wait -PassThru
    Assert-Equal $p.ExitCode 0 'Installer exit code'
}
function Run-Uninstall {
    $exe = Join-Path $directory 'uninstall.exe'
    if (Test-Path -LiteralPath $exe) {
        # _?= prevents the uninstaller from forking into a temporary copy.
        $p = Start-Process -FilePath $exe -ArgumentList "/S _?=$directory" -Wait -PassThru
        Assert-Equal $p.ExitCode 0 'Uninstaller exit code'
    }
}

# Refuse to disturb real installations or generic ProgIDs owned by other apps.
$mustBeAbsent = @($preferences, "$classes\$markdown", "$classes\$text",
    "$classes\Markdown Document", "$classes\Text Document", 'Software\MarkNext\Capabilities',
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkNext')
foreach ($path in $mustBeAbsent) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
    if ($null -ne $key) { $key.Dispose(); throw "Use a fresh Windows profile: $path already exists." }
}
if (Get-Process -Name marknext -ErrorAction SilentlyContinue) { throw 'Close MarkNext before testing.' }
if ($null -ne (Read-Value 'Software\RegisteredApplications' 'MarkNext')) { throw 'MarkNext is already registered.' }
foreach ($ext in $extensions) {
    if ($null -ne (Read-Value "$classes\.$ext\OpenWithProgids" $other)) { throw 'Test sentinel already exists.' }
}
$defaults = @{}
$userChoices = @{}
foreach ($ext in $extensions) {
    $defaults[$ext] = Read-Value "$classes\.$ext"
    $choice = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$ext\UserChoice"
    $userChoices[$ext] = @((Read-Value $choice 'ProgId'), (Read-Value $choice 'Hash'))
}
function Assert-Registration([bool]$Enabled) {
    foreach ($ext in $extensions) {
        $progId = if ($ext -eq 'txt') { $text } else { $markdown }
        $expected = if ($Enabled) { '' } else { $null }
        Assert-Equal (Read-Value "$classes\.$ext\OpenWithProgids" $progId) $expected ".$ext Open With"
        Assert-Equal (Read-Value "$classes\.$ext") $defaults[$ext] ".$ext default program"
        $choice = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$ext\UserChoice"
        Assert-Equal (Read-Value $choice 'ProgId') $userChoices[$ext][0] ".$ext UserChoice ProgId"
        Assert-Equal (Read-Value $choice 'Hash') $userChoices[$ext][1] ".$ext UserChoice hash"
        Assert-Equal (Read-Value "$classes\.$ext\OpenWithProgids" $other) '' ".$ext unrelated candidate"
        if ($Enabled) {
            Assert-Equal (Read-Value 'Software\MarkNext\Capabilities\FileAssociations' ".$ext") $progId 'Default apps capability'
        }
    }
    if ($Enabled) {
        foreach ($progId in @($markdown, $text)) {
            Assert-Equal (Read-Value "$classes\$progId\DefaultIcon") "`"$directory\markdown.ico`",0" 'Document icon'
            Assert-Equal (Read-Value "$classes\$progId\shell\open\command") "`"$directory\marknext.exe`" `"%1`"" 'Quoted command'
        }
        Assert-Equal (Read-Value 'Software\RegisteredApplications' 'MarkNext') 'Software\MarkNext\Capabilities' 'Registered application'
        Assert-Equal (Get-FileHash -LiteralPath "$directory\markdown.ico").Hash (Get-FileHash -LiteralPath $iconSource).Hash 'Packaged document icon'
    } else {
        Assert-Equal (Read-Value 'Software\RegisteredApplications' 'MarkNext') $null 'Registration removed'
        Assert-Equal (Read-Value "$classes\$markdown\shell\open\command") $null 'Markdown handler removed'
        Assert-Equal (Read-Value "$classes\$text\shell\open\command") $null 'Text handler removed'
    }
}

try {
    foreach ($ext in $extensions) { Write-Value "$classes\.$ext\OpenWithProgids" $other '' }
    Run-Setup ''
    Assert-Registration $false
    Run-Setup '/OPENWITH=1'
    Assert-Registration $true
    Run-Setup '/UPDATE'
    Assert-Registration $true
    Run-Setup '/OPENWITH=0'
    Assert-Registration $false
    Run-Setup '/UPDATE'
    Assert-Registration $false

    # An old Tauri association still owned by this install may be migrated;
    # a later user choice on .markdown must survive the old backup value.
    Write-Value "$classes\Markdown Document\shell\open\command" '' "$directory\marknext.exe `"%1`""
    Write-Value "$classes\.md" 'Markdown Document_backup' ([string]$defaults['md'])
    Write-Value "$classes\.md" '' 'Markdown Document'
    Write-Value "$classes\.markdown" 'Markdown Document_backup' 'Old.Default.Must.Not.Be.Restored'
    Run-Setup '/OPENWITH=1'
    Assert-Registration $true
    Assert-Equal (Read-Value "$classes\.md" 'Markdown Document_backup') $null 'Legacy backup removed'
    Assert-Equal (Read-Value "$classes\Markdown Document\shell\open\command") $null 'Legacy handler removed'

    Write-Value "$classes\Markdown Document\shell\open\command" '' 'C:\Another Editor\editor.exe "%1"'
    Run-Uninstall
    Assert-Registration $false
    Assert-Equal (Read-Value "$classes\Markdown Document\shell\open\command") 'C:\Another Editor\editor.exe "%1"' 'Foreign legacy handler retained'
    Assert-Equal (Test-Path -LiteralPath "$directory\markdown.ico") $false 'Document icon removed'
    Assert-Equal (Read-Value $preferences 'OpenWith') $null 'Preference removed'
    Write-Host 'PASS: opt-in, opt-out, upgrades, quoting, icons, legacy migration, defaults and uninstall.'
} finally {
    Run-Uninstall
    foreach ($ext in $extensions) { Remove-Value "$classes\.$ext\OpenWithProgids" $other }
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("$classes\Markdown Document", $false)
    if ($null -eq $defaults['md']) { Remove-Value "$classes\.md" '' }
    else { Write-Value "$classes\.md" '' $defaults['md'] }
    Remove-Value "$classes\.md" 'Markdown Document_backup'
    Remove-Value "$classes\.markdown" 'Markdown Document_backup'
    Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
}
