Require('dotenv').config();
const axios = require('axios');
const { SigningCosmWasmClient } = require('@cosmjs/cosmwasm-stargate');
const { GasPrice, coins } = require('@cosmjs/stargate');
const { DirectSecp256k1HdWallet, DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');

const config = {
  rpc: "https://testnet-rpc.zigchain.com",
  contract: "zig1vhr7hx0yeww0uwe2zlp6mst5g6aup85engzntlyv52rkmxsykvdskfv0tu",
  lpTokenDenom: "factory/coin.zig1vhr7hx0yeww0uwe2zlp6mst5g6aup85engzntlyv52rkmxsykvdskfv0tu.oroswaplptoken/lp",
  delayInSeconds: {
    betweenTransactions: 2,
    betweenLoops: 1800
  },
  swap: {
    enabled: true,
    countPerLoop: 2,
    slippage: 2.5,
    amountZIG: { min: 0.5, max: 1.0 },
    amountORO: { min: 0.5, max: 1.0 }
  },
  pools: {
    enabled: true,
    amountZIG: 0.8,
    amountORO: 0.8,
    withdrawEnabled: true
  }
};

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠️] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✖️] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.cyan}[➡️] ${msg}${colors.reset}`),
  loop: (msg) => console.log(`${colors.blue}\n===== ${msg} =====${colors.reset}`),
  link: (msg) => console.log(`${colors.cyan}\x1b[2m    ${msg}\x1b[0m`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log("╔═════════════════════════════════════════════╗");
    console.log("║ Oroswap Automatic Created By @PetrukStar    ║");
    console.log(`╚═════════════════════════════════════════════╝${colors.reset}\n`);
  },
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const DENOM_ORO = 'coin.zig10rfjm85jmzfhravjwpq3hcdz8ngxg7lxd0drkr.uoro';
const DENOM_ZIG = 'uzig';
const TOKEN_DECIMALS = { [DENOM_ZIG]: 6, [DENOM_ORO]: 6, [config.lpTokenDenom]: 6 };

function toMicroUnits(amount, denom) {
  const decimals = TOKEN_DECIMALS[denom] || 6;
  return Math.floor(parseFloat(amount) * Math.pow(10, decimals));
}

function fromMicroUnits(amount, denom) {
  const decimals = TOKEN_DECIMALS[denom] || 6;
  return parseFloat(amount) / Math.pow(10, decimals);
}

async function getWallet(key) {
  const trimmedKey = key.trim();
  if (trimmedKey.split(/\s+/).length >= 12) {
    return DirectSecp256k1HdWallet.fromMnemonic(trimmedKey, { prefix: 'zig' });
  }
  const processedKey = trimmedKey.startsWith('0x') ? trimmedKey.substring(2) : trimmedKey;
  const privateKeyBytes = Buffer.from(processedKey, 'hex');
  return DirectSecp256k1Wallet.fromKey(privateKeyBytes, 'zig');
}

async function refreshPoints(address, shouldLog = true) {
  try {
    const url = `https://testnet-api.oroswap.org/api/portfolio/${address}/points`;
    const axiosConfig = {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'origin': 'https://testnet.oroswap.org',
        'referer': 'https://testnet.oroswap.org/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    };
    const response = await axios.get(url, axiosConfig);
    const pointsData = response.data.points[0];

    const currentPoints = pointsData?.points ?? 0;
    const currentSwaps = pointsData?.swaps_count ?? 0;
    const currentPools = pointsData?.join_pool_count ?? 0;

    if (shouldLog) {
      logger.info(`Points updated: ${currentPoints} (Swaps: ${currentSwaps}, Pools: ${currentPools})`);
    }

    return {
        points: currentPoints,
        swaps_count: currentSwaps,
        join_pool_count: currentPools
    };
  } catch (e) {
    if(shouldLog) logger.warn(`Could not refresh points data: ${e.message}`);
    return { points: 0, swaps_count: 0, join_pool_count: 0 };
  }
}

async function displayAccountInfo(client, address) {
  logger.step('Loading account status...');
  try {
    const [zigBalance, oroBalance, pointsData] = await Promise.all([
      client.getBalance(address, DENOM_ZIG),
      client.getBalance(address, DENOM_ORO),
      refreshPoints(address, false)
    ]);
    const zigAmount = fromMicroUnits(zigBalance.amount, DENOM_ZIG);
    const oroAmount = fromMicroUnits(oroBalance.amount, DENOM_ORO);
    logger.info(`Balance: ${zigAmount.toFixed(4)} ZIG | ${oroAmount.toFixed(4)} ORO`);

    if(pointsData) {
      logger.info(`Points: ${pointsData.points} | Swaps: ${pointsData.swaps_count} | Pools: ${pointsData.join_pool_count}`);
    } else {
      logger.warn(`Points data unavailable for ${address}.`);
    }
  } catch(e) {
    logger.warn(`Failed to load account info: ${e.message}`);
  }
}

async function performSwap(client, address, fromDenom, amount, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_SECONDS = 30;

  try {
    logger.step(`Attempting to swap ${amount.toFixed(5)} ${fromDenom === DENOM_ZIG ? 'ZIG' : 'ORO'} (Attempt ${retryCount + 1})...`);
    const poolInfo = await client.queryContractSmart(config.contract, { pool: {} });
    const assetZIG = poolInfo.assets.find(a => a.info.native_token?.denom === DENOM_ZIG);
    const assetORO = poolInfo.assets.find(a => a.info.native_token?.denom === DENOM_ORO);
    let beliefPrice;
    if (fromDenom === DENOM_ZIG) {
      beliefPrice = (parseFloat(assetZIG.amount) / parseFloat(assetORO.amount)).toFixed(18);
    } else {
      beliefPrice = (parseFloat(assetORO.amount) / parseFloat(assetZIG.amount)).toFixed(18);
    }
    const msg = { swap: { offer_asset: { amount: toMicroUnits(amount, fromDenom).toString(), info: { native_token: { denom: fromDenom } } }, belief_price: beliefPrice, max_spread: (config.swap.slippage / 100).toString() } };
    const result = await client.execute(address, config.contract, msg, 'auto', 'Swap (Native)', coins(toMicroUnits(amount, fromDenom), fromDenom));
    logger.info(`Swap successful!`);
    logger.link(`Tx: https://zigscan.org/tx/${result.transactionHash}`);
    return { success: true };
  } catch (e) {
    const errorMessage = e.message.split('Broadcasting transaction failed')[0];
    logger.error(`Swap failed: ${errorMessage}`);

    if (errorMessage.includes("max spread limit") && retryCount < MAX_RETRIES) {
      logger.warn(`Max spread limit exceeded. Retrying in ${RETRY_DELAY_SECONDS} seconds... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(RETRY_DELAY_SECONDS * 1000);
      return performSwap(client, address, fromDenom, amount, retryCount + 1);
    }
    if (errorMessage.includes("account sequence mismatch") && retryCount < MAX_RETRIES) {
      logger.warn(`Sequence mismatch. Retrying... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(RETRY_DELAY_SECONDS * 1000);
      return { success: false, retrySequence: true };
    }
    return { success: false };
  }
}

async function performAddLiquidity(client, address) {
  try {
    logger.step(`Attempting to add liquidity: ${config.pools.amountZIG} ZIG & ${config.pools.amountORO} ORO...`);
    const assets = [
      { amount: toMicroUnits(config.pools.amountORO, DENOM_ORO).toString(), info: { native_token: { denom: DENOM_ORO } } },
      { amount: toMicroUnits(config.pools.amountZIG, DENOM_ZIG).toString(), info: { native_token: { denom: DENOM_ZIG } } }
    ];
    const msg = { provide_liquidity: { assets, slippage_tolerance: "0.5", auto_stake: false, } };
    const funds = [
      { denom: DENOM_ORO, amount: toMicroUnits(config.pools.amountORO, DENOM_ORO).toString() },
      { denom: DENOM_ZIG, amount: toMicroUnits(config.pools.amountZIG, DENOM_ZIG).toString() }
    ];
    const result = await client.execute(address, config.contract, msg, 'auto', '', funds);
    logger.info('Add liquidity successful!');
    logger.link(`Tx: https://zigscan.org/tx/${result.transactionHash}`);
    return { success: true };
  } catch(e) {
    const errorMessage = e.message.split('Broadcasting transaction failed')[0];
    logger.error(`Add liquidity failed: ${errorMessage}`);
    if (errorMessage.includes("account sequence mismatch")) {
      logger.warn(`Sequence mismatch. Not retrying as add liquidity is a single transaction per wallet.`);
      return { success: false, retrySequence: true };
    }
    return { success: false };
  }
}

async function performWithdrawLiquidity(client, address) {
  try {
    const lpBalance = await client.getBalance(address, config.lpTokenDenom);
    const lpAmount = lpBalance.amount;
    if (parseInt(lpAmount) === 0) {
      logger.warn('No liquidity (LP Tokens) to withdraw.');
      return { success: false };
    }
    logger.step(`Attempting to withdraw ${lpAmount} LP Tokens...`);
    const msg = { withdraw_liquidity: {} };
    const result = await client.execute(address, config.contract, msg, 'auto', '', coins(lpAmount, config.lpTokenDenom));
    logger.info('Withdraw liquidity successful!');
    logger.link(`Tx: https://zigscan.org/tx/${result.transactionHash}`);
    return { success: true };
  } catch(e) {
    const errorMessage = e.message.split('Broadcasting transaction failed')[0];
    logger.error(`Withdraw liquidity failed: ${errorMessage}`);
    if (errorMessage.includes("account sequence mismatch")) {
      logger.warn(`Sequence mismatch. Not retrying as withdrawal is a single transaction per wallet.`);
      return { success: false, retrySequence: true };
    }
    return { success: false };
  }
}

async function main() {
  logger.banner();

  const mnemonicKeys = Object.keys(process.env)
    .filter(key => key.startsWith('MNEMONIC_'))
    .sort((a, b) => {
        const numA = parseInt(a.substring('MNEMONIC_'.length));
        const numB = parseInt(b.substring('MNEMONIC_'.length));
        return numA - numB;
    })
    .map(key => process.env[key]);

  if (mnemonicKeys.length === 0) {
    return logger.error("No MNEMONIC_ keys found in .env file. Please add MNEMONIC_1, MNEMONIC_2, etc.");
  }

  logger.info(`Found ${mnemonicKeys.length} wallets to process.`);

  let globalLoopCount = 1;

  while (true) {
    logger.loop(`STARTING GLOBAL LOOP #${globalLoopCount}`);

    for (let i = 0; i < mnemonicKeys.length; i++) {
      const mnemonic = mnemonicKeys[i];
      let wallet;
      let account;
      let client;

      try {
        wallet = await getWallet(mnemonic);
        [account] = await wallet.getAccounts();
        client = await SigningCosmWasmClient.connectWithSigner(config.rpc, wallet, {
          gasPrice: GasPrice.fromString('0.03uzig'),
        });
        logger.info(`Processing wallet ${i + 1}/${mnemonicKeys.length}: ${account.address}`);
      } catch (e) {
        logger.error(`Failed to initialize wallet ${i + 1}: ${e.message}. Skipping this wallet.`);
        continue;
      }

      await displayAccountInfo(client, account.address);
      console.log('');

      if (config.swap.enabled) {
        logger.step(`Starting swap cycle (${config.swap.countPerLoop} transactions) for ${account.address}...`);
        for (let j = 0; j < config.swap.countPerLoop; j++) {
          let success = false;
          while (!success) {
            const fromDenom = j % 2 === 0 ? DENOM_ZIG : DENOM_ORO;
            const amountConfig = fromDenom === DENOM_ZIG ? config.swap.amountZIG : config.swap.amountORO;
            const amount = Math.random() * (amountConfig.max - amountConfig.min) + amountConfig.min;
            const result = await performSwap(client, account.address, fromDenom, amount);

            if (result.success) {
              success = true;
              await refreshPoints(account.address);
            } else if (result.retrySequence) {
              logger.warn(`Re-initializing client due to sequence mismatch...`);
              client = await SigningCosmWasmClient.connectWithSigner(config.rpc, wallet, {
                gasPrice: GasPrice.fromString('0.03uzig'),
              });
            } else {
              // Non-retryable error, exit loop
              break;
            }
          }
          logger.info(`Waiting for ${config.delayInSeconds.betweenTransactions} seconds...`);
          await delay(config.delayInSeconds.betweenTransactions * 1000);
        }
      }

      if (config.pools.enabled) {
        logger.step(`Starting pool cycle for ${account.address}...`);
        let added = false;
        while (!added) {
          const result = await performAddLiquidity(client, account.address);
          if (result.success) {
            added = true;
            await refreshPoints(account.address);
            if (config.pools.withdrawEnabled) {
              logger.info(`Waiting for ${config.delayInSeconds.betweenTransactions} seconds before withdrawing liquidity...`);
              await delay(config.delayInSeconds.betweenTransactions * 1000);
              let withdrawn = false;
              while(!withdrawn) {
                  const resultWithdraw = await performWithdrawLiquidity(client, account.address);
                  if (resultWithdraw.success) {
                      withdrawn = true;
                      await refreshPoints(account.address);
                  } else if (resultWithdraw.retrySequence) {
                      logger.warn(`Re-initializing client due to sequence mismatch...`);
                      client = await SigningCosmWasmClient.connectWithSigner(config.rpc, wallet, {
                        gasPrice: GasPrice.fromString('0.03uzig'),
                      });
                  } else {
                      break;
                  }
              }
            }
          } else if (result.retrySequence) {
            logger.warn(`Re-initializing client due to sequence mismatch...`);
            client = await SigningCosmWasmClient.connectWithSigner(config.rpc, wallet, {
              gasPrice: GasPrice.fromString('0.03uzig'),
            });
          } else {
            break;
          }
        }
      }
      logger.info(`Finished processing wallet ${account.address}`);
      console.log('');
    }

    globalLoopCount++;
    logger.loop(`ALL WALLETS PROCESSED. Waiting for ${config.delayInSeconds.betweenLoops} seconds for the next global loop...`);
    await delay(config.delayInSeconds.betweenLoops * 1000);
  }
}

main().catch(e => logger.error(`FATAL ERROR: ${e.message}`));
