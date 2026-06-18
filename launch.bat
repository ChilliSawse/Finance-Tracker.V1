@echo off
setlocal
set ROOT=%~dp0

echo.
echo  Finance Tracker - Local Dev Server
echo  ===================================
echo  Serving: %ROOT%
echo  Press Ctrl+C to stop.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%ROOT%'.TrimEnd('\');" ^
  "$port = 0;" ^
  "foreach ($p in @(5500, 3000, 8080, 8000, 4000)) {" ^
  "  try {" ^
  "    $test = [System.Net.HttpListener]::new();" ^
  "    $test.Prefixes.Add(\"http://localhost:$p/\");" ^
  "    $test.Start(); $test.Stop();" ^
  "    $port = $p; break;" ^
  "  } catch { }" ^
  "};" ^
  "if ($port -eq 0) { Write-Host 'ERROR: No free port found (tried 5500 3000 8080 8000 4000).' -ForegroundColor Red; exit 1 };" ^
  "$listener = [System.Net.HttpListener]::new();" ^
  "$listener.Prefixes.Add(\"http://localhost:$port/\");" ^
  "$listener.Start();" ^
  "Write-Host \" Server ready at http://localhost:$port\" -ForegroundColor Green;" ^
  "Start-Process \"http://localhost:$port\";" ^
  "$mimeTypes = @{" ^
  "  '.html' = 'text/html; charset=utf-8';" ^
  "  '.css'  = 'text/css; charset=utf-8';" ^
  "  '.js'   = 'application/javascript; charset=utf-8';" ^
  "  '.json' = 'application/json; charset=utf-8';" ^
  "  '.png'  = 'image/png';" ^
  "  '.ico'  = 'image/x-icon';" ^
  "  '.svg'  = 'image/svg+xml';" ^
  "  '.woff2'= 'font/woff2';" ^
  "};" ^
  "while ($listener.IsListening) {" ^
  "  try {" ^
  "    $ctx  = $listener.GetContext();" ^
  "    $req  = $ctx.Request;" ^
  "    $res  = $ctx.Response;" ^
  "    $path = $req.Url.LocalPath -replace '/', [IO.Path]::DirectorySeparatorChar;" ^
  "    $path = $path.TrimStart([IO.Path]::DirectorySeparatorChar);" ^
  "    if ([string]::IsNullOrEmpty($path) -or $path -eq '\') { $path = 'index.html' };" ^
  "    $file = Join-Path $root $path;" ^
  "    Write-Host \"  $($req.HttpMethod) $($req.Url.LocalPath)\" -ForegroundColor DarkGray;" ^
  "    if (Test-Path $file -PathType Leaf) {" ^
  "      $ext  = [IO.Path]::GetExtension($file).ToLower();" ^
  "      $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' };" ^
  "      $bytes = [IO.File]::ReadAllBytes($file);" ^
  "      $res.ContentType     = $mime;" ^
  "      $res.ContentLength64 = $bytes.Length;" ^
  "      $res.StatusCode      = 200;" ^
  "      $res.OutputStream.Write($bytes, 0, $bytes.Length);" ^
  "    } else {" ^
  "      $body  = [Text.Encoding]::UTF8.GetBytes(\"404 - Not Found: $path\");" ^
  "      $res.StatusCode      = 404;" ^
  "      $res.ContentType     = 'text/plain; charset=utf-8';" ^
  "      $res.ContentLength64 = $body.Length;" ^
  "      $res.OutputStream.Write($body, 0, $body.Length);" ^
  "    };" ^
  "    $res.OutputStream.Close();" ^
  "  } catch { break };" ^
  "};"

endlocal
