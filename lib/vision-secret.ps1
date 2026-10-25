# 保存/解密当前 Windows 用户的视觉 API Key；仅由插件本地受限接口调用。
param(
  [Parameter(Mandatory=$true)][ValidateSet('store','load')][string]$Action,
  [Parameter(Mandatory=$true)][string]$Path
)
$ErrorActionPreference='Stop'
try {
  if ($Action -eq 'store') {
    $encoded=[Console]::In.ReadToEnd().Trim()
    if ($encoded.Length -lt 12 -or $encoded.Length -gt 16384) { throw 'invalid input size' }
    $plain=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
    if ($plain.Length -lt 8 -or $plain.Length -gt 4096 -or $plain.Contains("`n") -or $plain.Contains("`r")) {throw 'invalid key length'}
    $secure=ConvertTo-SecureString -String $plain -AsPlainText -Force
    $cipher=ConvertFrom-SecureString -SecureString $secure
    $parent=[IO.Path]::GetDirectoryName($Path)
    [IO.Directory]::CreateDirectory($parent)|Out-Null
    $tmp=$Path+'.tmp'
    [IO.File]::WriteAllText($tmp,$cipher,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
    [Console]::Out.Write('ok')
  } else {
    if (-not [IO.File]::Exists($Path)) {exit 2}
    $cipher=[IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8)
    $secure=ConvertTo-SecureString -String $cipher.Trim()
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
      [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain)))
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }
} catch {
  # 不回显 Key、密文或原始异常内容。
  [Console]::Error.Write('vision secret operation failed')
  exit 1
}
