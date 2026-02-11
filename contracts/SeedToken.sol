// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * $SEED token for Bird Game.
 * - In-game SEED is claimed as $SEED to the player's wallet (mint).
 * - Gacha and Loft upgrade are paid in $SEED and immediately burned.
 *   (burn() / burnFrom() により totalSupply も減少する純粋なバーン)
 * Local/test: deployer can mint. Production: restrict mint to game backend or claim contract.
 */
contract SeedToken is ERC20Burnable, Ownable {
    constructor() ERC20("Seed", "SEED") Ownable(msg.sender) {}

    /// @notice Mint $SEED to an address (e.g. when user Claims in-game SEED).
    ///         On local/test, anyone can mint for convenience; restrict in production.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
