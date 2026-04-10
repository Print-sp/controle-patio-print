function Join-Chars([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }
$text = Get-Content -Path 'C:\Users\Pixel Midia 3D\controle-patio-print\server-atualizado.js' -Raw -Encoding UTF8
$replacements = @(
    @{ old = (Join-Chars @(195,161)); new = 'á' }, @{ old = (Join-Chars @(195,160)); new = 'à' }, @{ old = (Join-Chars @(195,162)); new = 'â' }, @{ old = (Join-Chars @(195,163)); new = 'ã' }, @{ old = (Join-Chars @(195,164)); new = 'ä' },
    @{ old = (Join-Chars @(195,169)); new = 'é' }, @{ old = (Join-Chars @(195,168)); new = 'è' }, @{ old = (Join-Chars @(195,170)); new = 'ê' }, @{ old = (Join-Chars @(195,171)); new = 'ë' },
    @{ old = (Join-Chars @(195,173)); new = 'í' }, @{ old = (Join-Chars @(195,172)); new = 'ì' }, @{ old = (Join-Chars @(195,174)); new = 'î' }, @{ old = (Join-Chars @(195,175)); new = 'ï' },
    @{ old = (Join-Chars @(195,179)); new = 'ó' }, @{ old = (Join-Chars @(195,178)); new = 'ò' }, @{ old = (Join-Chars @(195,180)); new = 'ô' }, @{ old = (Join-Chars @(195,181)); new = 'õ' }, @{ old = (Join-Chars @(195,182)); new = 'ö' },
    @{ old = (Join-Chars @(195,186)); new = 'ú' }, @{ old = (Join-Chars @(195,185)); new = 'ù' }, @{ old = (Join-Chars @(195,187)); new = 'û' }, @{ old = (Join-Chars @(195,188)); new = 'ü' },
    @{ old = (Join-Chars @(195,167)); new = 'ç' }, @{ old = (Join-Chars @(195,129)); new = 'Á' }, @{ old = (Join-Chars @(195,130)); new = 'Â' }, @{ old = (Join-Chars @(195,131)); new = 'Ã' }, @{ old = (Join-Chars @(195,137)); new = 'É' }, @{ old = (Join-Chars @(195,141)); new = 'Í' }, @{ old = (Join-Chars @(195,147)); new = 'Ó' }, @{ old = (Join-Chars @(195,154)); new = 'Ú' }, @{ old = (Join-Chars @(195,135)); new = 'Ç' },
    @{ old = (Join-Chars @(226,128,162)); new = '•' }, @{ old = (Join-Chars @(226,128,147)); new = '–' }, @{ old = (Join-Chars @(226,128,148)); new = '—' }, @{ old = (Join-Chars @(194,160)); new = ' ' }, @{ old = (Join-Chars @(194,173)); new = '' }
)
foreach ($r in $replacements) { $text = $text.Replace($r.old, $r.new) }
Set-Content -Path 'C:\Users\Pixel Midia 3D\controle-patio-print\server-ptbr-unicode.js' -Value $text -Encoding UTF8
