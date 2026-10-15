// Regression gates for the three defects demonstrated in the earlier review.
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','--test-name-pattern','Spreading never|Expense retries are atomic|Concurrent overlapping leases','tests/finance.test.mjs','tests/api.integration.test.mjs'],{cwd:new URL('../',import.meta.url),stdio:'inherit'});
process.exitCode=result.status??1;
