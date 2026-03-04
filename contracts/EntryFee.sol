// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract EntryFee is Ownable {
    uint256 public fee;
    mapping(address => bool) public hasPaid;

    event Paid(address indexed player, uint256 amount);
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(uint256 _fee) Ownable(msg.sender) {
        fee = _fee;
    }

    function pay() external payable {
        require(msg.value >= fee, "Insufficient fee");
        require(!hasPaid[msg.sender], "Already paid");
        hasPaid[msg.sender] = true;
        emit Paid(msg.sender, msg.value);
    }

    function grantPaid(address[] calldata players) external onlyOwner {
        for (uint256 i = 0; i < players.length; i++) {
            hasPaid[players[i]] = true;
        }
    }

    function setFee(uint256 _fee) external onlyOwner {
        emit FeeUpdated(fee, _fee);
        fee = _fee;
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
