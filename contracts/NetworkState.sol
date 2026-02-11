// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * デッキのパワー総数とLOFTレベルをオンチェーンに保存。
 * - SEED/DAY と NETWORK SHARE はこの値をもとに算出する。
 * - updatePower: デッキ保存のたびに呼ぶ（ガス代は都度発生）。
 * - setLoftLevel: レベルアップ時（burn 後に呼ぶ）。
 */
contract NetworkState {
    uint256 public constant MAX_LEVEL = 6;

    mapping(address => uint256) public power;
    mapping(address => uint256) public loftLevel; // 0 = 未登録, 1..6

    uint256 public totalPower;
    /// @dev levelCounts[1]..[6] = レベル1..6の人数。0は未使用。
    uint256[7] public levelCounts;
    /// @dev globalRarityCounts[0..4] = Common, Uncommon, Rare, Epic, Legendary の鳥の総数
    uint256[5] public globalRarityCounts;

    event PowerUpdated(address indexed user, uint256 newPower);
    event RarityCountsAdded(uint256[5] added);
    event LoftLevelSet(address indexed user, uint256 level);

    /// @param newPower デッキのパワー総数（フロントで算出した値）
    function updatePower(uint256 newPower) external {
        uint256 old = power[msg.sender];
        totalPower = totalPower - old + newPower;
        power[msg.sender] = newPower;

        // 初回登録: レベル1として levelCounts[1] をインクリメント
        if (loftLevel[msg.sender] == 0) {
            loftLevel[msg.sender] = 1;
            levelCounts[1]++;
        }
        emit PowerUpdated(msg.sender, newPower);
    }

    /// @param level 1..6
    function setLoftLevel(uint256 level) external {
        require(level >= 1 && level <= MAX_LEVEL, "NetworkState: level 1-6");
        uint256 current = loftLevel[msg.sender];
        if (current == 0) {
            loftLevel[msg.sender] = level;
            levelCounts[level]++;
        } else {
            levelCounts[current]--;
            loftLevel[msg.sender] = level;
            levelCounts[level]++;
        }
        emit LoftLevelSet(msg.sender, level);
    }

    function getMyPower(address account) external view returns (uint256) {
        return power[account];
    }

    function getMyLoftLevel(address account) external view returns (uint256) {
        uint256 lv = loftLevel[account];
        return lv == 0 ? 1 : lv;
    }

    /// @return 自分のシェア（百分率 * 100。例: 5.25% => 525）
    function getMyShareBps(address account) external view returns (uint256) {
        if (totalPower == 0) return 0;
        return (power[account] * 10000) / totalPower;
    }

    /// @return levelCounts[1]..[6]
    function getLevelCounts() external view returns (uint256[6] memory) {
        return [
            levelCounts[1],
            levelCounts[2],
            levelCounts[3],
            levelCounts[4],
            levelCounts[5],
            levelCounts[6]
        ];
    }

    /// @param toAdd [Common, Uncommon, Rare, Epic, Legendary] の増分
    function addRarityCounts(uint256[5] calldata toAdd) external {
        for (uint256 i = 0; i < 5; i++) {
            globalRarityCounts[i] += toAdd[i];
        }
        emit RarityCountsAdded(toAdd);
    }

    /// @return globalRarityCounts[0..4]
    function getGlobalRarityCounts() external view returns (uint256[5] memory) {
        return globalRarityCounts;
    }
}
