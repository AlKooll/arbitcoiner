"use strict";
process.env.UV_THREADPOOL_SIZE = 128;
const appRoot  = require('app-root-path');
const events   = require('events');
const Logger   = require(appRoot + '/utils/logger.js');
const Poloniex = require('poloniex-api-node');
const Queue    = require('superqueue');

const config   = require(appRoot + '/config/local.config.json');

process.on('unhandledRejection', (reason, p) => {
    Log.info('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

const Log = Logger('trader_02', appRoot + '/data/logs/ledger', appRoot + '/data/logs/info');
const emitter = new events.EventEmitter();
const poloniex = new Poloniex();
const privatePolo = {
    private_0: new Poloniex(...config.private_0),
    private_1: new Poloniex(...config.private_1),
    private_2: new Poloniex(...config.private_2),
    private_util: new Poloniex(...config.private_util),
};

const tickerData = {
    startTime: 0,
    executions: 0,
};


const queue = new Queue({
    rate: 6,
    concurrency: 100000,
});
queue.addFlag('private_0', { concurrency: 1 });
queue.addFlag('private_1', { concurrency: 1 });
queue.addFlag('private_2', { concurrency: 1 });
queue.addFlag('private_util', { concurrency: 1 });
queue.addFlag('ticker', { concurrency: 1, interval: 350 });

const COINS = ['BTC', 'ETH', 'BCH'];
const status = COINS.reduce((acc, val) => {
    acc[val] = {
        balance: 0,
        busy: false,
        BTC: { lowestAsk: 0, highestBid: 0 },
        ETH: { lowestAsk: 0, highestBid: 0 },
        BCH: { lowestAsk: 0, highestBid: 0 },
    };
    acc[val][val] = { lowestAsk: 1, highestBid: 1 };
    return acc;
}, {});


const timestamp = () => {
    const time = new Date();
    return time.toString();
};


// Permanent rolling ticker
const addTicker = (priority = 5, once = false) => {
    return queue.push({ flags: ['ticker'], priority: priority }, () => {
        return poloniex.returnTicker();
    })
        .then((result) => {
            let changed = false;

            if (status.BTC.ETH.highestBid = +result.BTC_ETH.highestBid) {
                changed = true;
                status.BTC.ETH.highestBid = +result.BTC_ETH.highestBid;
                status.ETH.BTC.lowestAsk = 1/ +result.BTC_ETH.highestBid;
            }

            if (status.BTC.ETH.lowestAsk = +result.BTC_ETH.lowestAsk) {
                changed = true;
                status.BTC.ETH.lowestAsk = +result.BTC_ETH.lowestAsk;
                status.ETH.BTC.highestBid = 1/ +result.BTC_ETH.lowestAsk;
            }

            if (status.BTC.BCH.highestBid = +result.BTC_BCH.highestBid) {
                changed = true;
                status.BTC.BCH.highestBid = +result.BTC_BCH.highestBid;
                status.BCH.BTC.lowestAsk = 1/ +result.BTC_BCH.highestBid;
            }

            if (status.BTC.BCH.lowestAsk = +result.BTC_BCH.lowestAsk) {
                changed = true;
                status.BTC.BCH.lowestAsk = +result.BTC_BCH.lowestAsk;
                status.BCH.BTC.highestBid = 1/ +result.BTC_BCH.lowestAsk;
            }

            if (status.ETH.BCH.highestBid = +result.ETH_BCH.highestBid) {
                changed = true;
                status.ETH.BCH.highestBid = +result.ETH_BCH.highestBid;
                status.BCH.ETH.lowestAsk = 1/ +result.ETH_BCH.highestBid;
            }

            if (status.ETH.BCH.lowestAsk = +result.ETH_BCH.lowestAsk) {
                changed = true;
                status.ETH.BCH.lowestAsk = +result.ETH_BCH.lowestAsk;
                status.BCH.ETH.highestBid = 1/ +result.ETH_BCH.lowestAsk;
            }

            if (changed) {
                emitter.emit('tryTrade');
            }
        })
        .catch((err) => {
            Log.info('Error:', err);
        })
        .then(() => {
            if (!once) {
                tickerData.executions++;
                setImmediate(addTicker);
            }
        });
};

async function updateBalances() {
    const newBal = await queue.push({ flags: ['private_util'] }, () => privatePolo.private_util.returnBalances());
    status.BTC.balance = newBal.BTC;
    status.BCH.balance = newBal.BCH;
    status.ETH.balance = newBal.ETH;
}

const appraisePortfolioIn = (targetCoin, portfolio) => {
    return COINS.reduce((acc, coin) => acc + portfolio[coin] * status[targetCoin][coin].highestBid, 0);
};

const coinListWithExclude = (coin) => {
    return COINS.reduce((acc, val) => {
        if (coin !== val) {
            acc.push(val);
        }
        return acc;
    }, []);
};

const profits = {
    BTC: {
        BTC: { BTC: 0, ETH: 0, BCH: 0 },
        ETH: { BTC: 0, ETH: 0, BCH: 0 },
        BCH: { BTC: 0, ETH: 0, BCH: 0 },
    },
    ETH: {
        BTC: { BTC: 0, ETH: 0, BCH: 0 },
        ETH: { BTC: 0, ETH: 0, BCH: 0 },
        BCH: { BTC: 0, ETH: 0, BCH: 0 },
    },
    BCH: {
        BTC: { BTC: 0, ETH: 0, BCH: 0 },
        ETH: { BTC: 0, ETH: 0, BCH: 0 },
        BCH: { BTC: 0, ETH: 0, BCH: 0 },
    },
};

const checkProfitability = (soldCoin, boughtCoin, valueCoin) => {
    const initialPortfolio = {};
    initialPortfolio[soldCoin] = status[soldCoin].balance;
    initialPortfolio[boughtCoin] = 0;
    initialPortfolio[valueCoin] = 0;

    const initialValues = {
        soldCoin: appraisePortfolioIn(soldCoin, initialPortfolio),
        boughtCoin: appraisePortfolioIn(boughtCoin, initialPortfolio),
        valueCoin: appraisePortfolioIn(valueCoin, initialPortfolio),
    };

    const finalPortfolio = {};
    finalPortfolio[soldCoin] = 0;
    finalPortfolio[boughtCoin] = initialPortfolio[soldCoin] * status[boughtCoin][soldCoin].highestBid * 0.9975;
    finalPortfolio[valueCoin] = 0;

    const finalValues = {
        soldCoin: appraisePortfolioIn(soldCoin, finalPortfolio),
        boughtCoin: appraisePortfolioIn(boughtCoin, finalPortfolio),
        valueCoin: appraisePortfolioIn(valueCoin, finalPortfolio),
    };

    const percentChanges = {
        soldCoin: (100 * (finalValues.soldCoin - initialValues.soldCoin) / initialValues.soldCoin),
        boughtCoin: (100 * (finalValues.boughtCoin - initialValues.boughtCoin) / initialValues.boughtCoin),
        valueCoin: (100 * (finalValues.valueCoin - initialValues.valueCoin) / initialValues.valueCoin),
    };
    const percentChangeSum = percentChanges.soldCoin + percentChanges.boughtCoin + percentChanges.valueCoin;

    if (profits[soldCoin][boughtCoin][valueCoin] !== percentChangeSum.toFixed(3)) {
        profits[soldCoin][boughtCoin][valueCoin] = percentChangeSum.toFixed(3);

        if (percentChanges.valueCoin > 0.5) {
            Log.info('Old trigger reached!');
        }

        Log.info(timestamp(), `Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}, `,
            `% gain: ${percentChanges.soldCoin.toFixed(3)}, ${percentChanges.boughtCoin.toFixed(3)}, ${percentChanges.valueCoin.toFixed(3)}, `,
            `Sum: ${percentChangeSum.toFixed(3)}, `,
            `Ticker rate: ${tickerData.executions / ((Date.now() - tickerData.startTime) / 1000)}, `,
            `Ticker calls: ${tickerData.executions}`);
        if (percentChangeSum > 0) {
            Log.ledger(`\n    Trade found! ${timestamp()}`,
                `\n        Sell: ${soldCoin},  Buy: ${boughtCoin},  Value: ${valueCoin}`,
                `\n        Initial value: ${initialValues.valueCoin}`,
                `\n        Initial portfolio: `, initialPortfolio,
                `\n        Final value: ${finalValues.valueCoin}`,
                `\n        Final portfolio: `, finalPortfolio,
                `\n        Final % gain soldCoin   ${soldCoin}: ${percentChanges.soldCoin.toFixed(3)}`,
                `\n        Final % gain boughtCoin ${boughtCoin}: ${percentChanges.boughtCoin.toFixed(3)}`,
                `\n        Final % gain valueCoin  ${valueCoin}: ${percentChanges.valueCoin.toFixed(3)}`,
                `\n        Final % gain total         : ${percentChangeSum.toFixed(3)}`,
                `\n\n       `, status, '\n');
        }
    }

    return percentChangeSum > 0;
};

// Coin specified is the one being sold. The other two are the one being bought, and the one being used to value
const tryTradeForCoin = (soldCoin) => {
    const otherCoins = coinListWithExclude(soldCoin);

    if (checkProfitability(soldCoin, otherCoins[0], otherCoins[1])) {
        // Make trade
    } else if (checkProfitability(soldCoin, otherCoins[1], otherCoins[0])) {
        // Make trade
    }
};

emitter.on('tryTrade', () => {
    COINS.forEach(tryTradeForCoin);
});

function wait(delay) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), delay);
    });
}

const initialize = async() => {
    Log.console('Initializing');
    await updateBalances();
    await addTicker(5, true);
    await Log.ledger(timestamp(), status, '\n');
    Log.console('Initialized');
    tickerData.startTime = Date.now();
    addTicker();
    addTicker();
};

initialize();
