// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * 報酬プールからの Claim。バックエンドの署名により「このアドレスがこの量を引き出してよい」を検証し、
 * プールから transfer する。ユーザーが claim() を呼ぶのでガス代はユーザー負担。
 */
contract RewardClaim {
    IERC20 public immutable seedToken;
    address public immutable pool;
    address public immutable signer;

    mapping(bytes32 => bool) public usedNonces;

    event Claimed(address indexed user, uint256 amount);

    constructor(address _seedToken, address _pool, address _signer) {
        seedToken = IERC20(_seedToken);
        pool = _pool;
        signer = _signer;
    }

    /**
     * バックエンドが sign(keccak256(abi.encodePacked(user, amount, nonce))) した署名を使って、
     * 報酬プールから msg.sender へ amount を転送する。
     */
    function claim(uint256 amount, uint256 nonce, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 hash = keccak256(abi.encodePacked(msg.sender, amount, nonce));
        require(!usedNonces[hash], "RewardClaim: nonce already used");
        usedNonces[hash] = true;

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address recovered = ecrecover(ethSignedHash, v, r, s);
        require(recovered == signer && recovered != address(0), "RewardClaim: invalid signature");

        require(IERC20(seedToken).transferFrom(pool, msg.sender, amount), "RewardClaim: transfer failed");
        emit Claimed(msg.sender, amount);
    }
}
