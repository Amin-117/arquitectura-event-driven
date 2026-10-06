// Lista los targets del Makefile con su descripción (`make help`).
import { readFileSync } from 'node:fs'

const makefile = readFileSync(new URL('../Makefile', import.meta.url), 'utf8')
for (const line of makefile.split('\n')) {
  const match = /^([a-z-]+):.*##\s*(.+)$/.exec(line)
  if (match) console.log(`  make ${match[1].padEnd(22)} ${match[2]}   (npm run ${match[1]})`)
}
