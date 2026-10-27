import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('compiled launcher keeps the shared profile by default and isolates only by explicit opt-in with legacy taking precedence', {skip:process.platform!=='win32'},()=>{
 const windows=process.env.SystemRoot??'C:\\Windows';
 const compiler=path.join(windows,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 const powershell=path.join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const launcher=fileURLToPath(new URL('../launcher.cs',import.meta.url));
 assert.ok(fs.existsSync(compiler),'Windows .NET Framework compiler is required to check the real launcher');
 const temporaryRoot=fs.realpathSync(os.tmpdir());
 const temporary=fs.mkdtempSync(path.join(temporaryRoot,'aim-launcher-test-'));
 try{
  const assembly=path.join(temporary,'Launcher.dll'),script=path.join(temporary,'reflect.ps1'),casesFile=path.join(temporary,'cases.json');
  const compiled=spawnSync(compiler,['/nologo','/codepage:65001','/target:library','/r:System.Windows.Forms.dll','/out:'+assembly,launcher],{encoding:'utf8',windowsHide:true});
  assert.equal(compiled.status,0,compiled.stdout+'\n'+compiled.stderr);
  const cases=[
   {profilePath:'C:\\Users\\测试 用户\\AppData\\Local\\AimOffline\\EdgeProfile',args:[],isolated:false},
   {profilePath:null,args:['--legacy-profile'],isolated:false},
   {profilePath:'C:\\Users\\测试 用户\\AppData\\Local\\AimOffline\\EdgeProfile',args:['--isolated-profile'],isolated:true},
   {profilePath:'D:\\游戏 工具\\中文 配置\\',args:['--ISOLATED-PROFILE'],isolated:true},
   {profilePath:'\\\\server\\共享 目录\\Edge 配置',args:['--isolated-profile'],isolated:true},
   {profilePath:'C:\\Path with spaces\\EdgeProfile',args:['--isolated-profile','--legacy-profile'],isolated:false},
   {profilePath:null,args:['--LEGACY-PROFILE','--isolated-profile'],isolated:false},
   {profilePath:null,args:['--unrelated-option'],isolated:false},
  ];
  fs.writeFileSync(casesFile,JSON.stringify(cases));
  fs.writeFileSync(script,`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OfflineLauncherArgumentParser {
 [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
 private static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
 [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
 public static string[] Split(string commandLine) {
  int count; IntPtr memory = CommandLineToArgvW(commandLine, out count);
  if (memory == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
  try {
   string[] result = new string[count];
   for (int index = 0; index < count; index++) result[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, index * IntPtr.Size));
   return result;
  } finally { LocalFree(memory); }
 }
}
'@
$assembly = [Reflection.Assembly]::LoadFrom($args[0])
$type = $assembly.GetType('OfflineLauncher', $true)
$method = $type.GetMethod('BuildEdgeArguments', [Reflection.BindingFlags]'NonPublic,Static')
if ($null -eq $method) { throw 'Real launcher BuildEdgeArguments helper is missing' }
$selector = $type.GetMethod('UseIsolatedProfile', [Reflection.BindingFlags]'NonPublic,Static')
if ($null -eq $selector) { throw 'Real launcher profile mode selector is missing' }
$results = @()
foreach ($case in (Get-Content -LiteralPath $args[1] -Raw -Encoding UTF8 | ConvertFrom-Json)) {
 $selectionArguments = New-Object object[] 1
 $selectionArguments[0] = [string[]]@($case.args)
 $isolated = [bool]$selector.Invoke($null, $selectionArguments)
 $arguments = $method.Invoke($null, [object[]]@($case.profilePath, !$isolated))
 $results += [pscustomobject]@{isolated=$isolated;arguments=$arguments;parsed=@([OfflineLauncherArgumentParser]::Split('offline.exe ' + $arguments))}
}
$results | ConvertTo-Json -Depth 5 -Compress
`);
  const checked=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,assembly,casesFile],{encoding:'utf8',windowsHide:true});
  assert.equal(checked.status,0,checked.stdout+'\n'+checked.stderr);
  const results=JSON.parse(checked.stdout.trim());assert.equal(results.length,cases.length);
  const fixed=['offline.exe','--app=http://127.0.0.1:18746/aim','--no-first-run','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-background-timer-throttling'];
  for(let index=0;index<cases.length;index++){
   const entry=cases[index],expected=entry.isolated?[...fixed,'--user-data-dir='+entry.profilePath]:fixed;
   assert.equal(results[index].isolated,entry.isolated,'only explicit isolated opt-in can select a new profile; legacy wins either conflict order');
   assert.deepEqual(results[index].parsed,expected,'native Windows argument parsing preserves the selected profile path');
   if(!entry.isolated)assert.ok(!results[index].arguments.includes('--user-data-dir'));
   else assert.ok(results[index].arguments.includes('--user-data-dir="'),'independent profile paths are explicitly quoted');
  }
  const source=fs.readFileSync(launcher,'utf8');
  assert.match(source,/SpecialFolder\.LocalApplicationData/);
  assert.match(source,/"AimOffline", "EdgeProfile"/);
  assert.match(source,/bool isolated = UseIsolatedProfile\(args\)/);
  assert.match(source,/if \(isolated\)\s+Directory\.CreateDirectory\(profilePath\)/,'the independent directory is created only after explicit opt-in');
  assert.equal(source.match(/Directory\.CreateDirectory\(/g)?.length,1);
  assert.match(source,/Arguments = BuildEdgeArguments\(profilePath, !isolated\)/,'the live launch path must use the verified selector and helper');
  assert.match(source,/"--legacy-profile", StringComparison\.OrdinalIgnoreCase/);
  assert.match(source,/"--isolated-profile", StringComparison\.OrdinalIgnoreCase/);
 }finally{
  // Verify the resolved target is this test's fresh, explicitly named temp dir.
  const resolved=fs.realpathSync(temporary);
  assert.equal(path.dirname(resolved).toLowerCase(),temporaryRoot.toLowerCase());
  assert.ok(path.basename(resolved).startsWith('aim-launcher-test-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
});
