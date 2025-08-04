# Oroswap Automatic

This is an automated script to perform various actions on Oroswap (swapping and liquidity management) on the ZigChain testnet. It supports managing multiple wallets from a single instance.

## Features

-   **Automated Swaps:** Performs randomized ZIG <-> ORO swaps.
-   **Automated Liquidity Management:** Adds and optionally withdraws liquidity.
-   **Multi-Wallet Support:** Manages multiple wallets defined in the `.env` file.
-   **Points Tracking:** Displays and refreshes accumulated points.
-   **Configurable Delays:** Adjust delay between transactions and loops.
-   **Slippage Tolerance:** Customizable slippage for swaps to improve success rate.
-   **Retry Logic:** Automatically retries failed swaps due to "max spread limit".

## Installation
 **Install Dependencies:**

    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a file named `.env` in the root directory of the project. This file will store your mnemonic phrases.
    Add your mnemonic phrases for each wallet you want to manage, prefixed with `MNEMONIC_` and a number, like this:

##

    ```
    MNEMONIC_1="your first wallet's 12-word mnemonic phrase here"
    MNEMONIC_2="your second wallet's 12-word mnemonic phrase here"
    MNEMONIC_3="your third wallet's 12-word mnemonic phrase here"
    # Add more MNEMONIC_X entries as needed
    ```

## Usage

To start the bot, simply run:

```bash
npm start
```

Join now with VIP room
https://t.me/SatpolPProbot
Created by: https://t.me/PetrukStar
Channel: https://t.me/SeputarNewAirdropp
