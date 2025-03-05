#!/usr/bin/env deno run

/**
 * 1on1組み合わせ作成ツール (修正版)
 *
 * 1ヶ月に1回、部内メンバー同士でメンターとメンティーに分かれて1on1をする際の組み合わせを作成します。
 *
 * 入力: JSONファイル
 *   - members: string[] - メンバーリスト
 *   - excluded: [string, string][] - 除外組み合わせリスト（メンター、メンティーの順。逆も除外）
 *   - months: MonthData[] - 過去の月ごとのデータ
 *     - month: string - 年月 (例: "2021年10月")
 *     - skip: string | null - スキップしたメンバーの名前 (いない場合は null)
 *     - assignments: Assignment[] - 1on1の組み合わせリスト
 *       - mentor: string - メンターの名前
 *       - mentee: string - メンティーの名前
 *
 * 出力: 標準出力にJSON形式で出力 (入力JSONに新しい月のデータを追加したもの)
 *
 * 使用方法:
 *   deno run peer-1on1.ts input.json
 *
 *   input.json の例: (以前の例を参照)
 */

interface Assignment {
    mentor: string;
    mentee: string;
  }
  
  interface MonthData {
    month: string;
    skip: string | null;
    assignments: Assignment[];
  }
  
  interface InputData {
    members: string[];
    excluded: [string, string][];
    months: MonthData[];
  }
  
  /**
   * JSONファイルから入力を読み込む (変更なし)
   */
  async function readInput(filePath: string): Promise<InputData | null> {
    try {
      const file = await Deno.readTextFile(filePath);
      const jsonData = JSON.parse(file);
      return jsonData as InputData;
    } catch (e) {
      console.error("入力ファイルの読み込みに失敗しました:", e);
      return null;
    }
  }
  
  /**
   * 組み合わせが除外リストに含まれているかチェック (変更なし)
   */
  function isExcluded(pair: [string, string], excludedList: [string, string][]): boolean {
    return excludedList.some(excludedPair =>
      (excludedPair[0] === pair[0] && excludedPair[1] === pair[1]) ||
      (excludedPair[0] === pair[1] && excludedPair[1] === pair[0])
    );
  }
  
  /**
   * 過去の組み合わせから、指定されたメンバーの直近のペアを取得 (変更なし)
   */
  function getRecentPair(member: string, months: MonthData[]): Assignment | null {
    for (let i = months.length - 1; i >= 0; i--) { // 直近の月データから遡る
      const monthData = months[i];
      const assignment = monthData.assignments.find(
        (assignment) => assignment.mentor === member || assignment.mentee === member
      );
      if (assignment) {
        return assignment;
      }
    }
    return null;
  }
  
  /**
   * 過去の全組み合わせから、指定されたペアと一致する組み合わせを時系列順に取得
   * @param pair チェックする組み合わせ [メンバー1, メンバー2]
   * @param months 過去の月データリスト
   * @returns Assignment[] 一致する組み合わせのリスト (時系列順)
   */
  function getPastPairs(pair: [string, string], months: MonthData[]): Assignment[] {
    const pastPairs: Assignment[] = [];
    for (const monthData of months) {
      for (const assignment of monthData.assignments) {
        if (
          (assignment.mentor === pair[0] && assignment.mentee === pair[1]) ||
          (assignment.mentor === pair[1] && assignment.mentee === pair[0])
        ) {
          pastPairs.push(assignment);
        }
      }
    }
    return pastPairs;
  }
  
  
  /**
   * 1on1の組み合わせを作成する (ロジックを大幅に修正)
   */
  function createAssignments(
    members: string[],
    excludedList: [string, string][],
    pastMonths: MonthData[]
  ): { assignments: Assignment[]; skip: string[] } {
    const availableMentors = [...members];
    const availableMentees = [...members];
    const assignments: Assignment[] = [];
    const skip: string[] = [];
    const usedPairs: Set<string> = new Set(); // 使用したペアを記録 (mentor:mentee 形式の文字列)
  
    // ペアが使用済みかチェック (mentor:mentee と mentee:mentor の両方をチェック)
    const isPairUsed = (mentor: string, mentee: string): boolean => {
      const pair1 = `${mentor}:${mentee}`;
      const pair2 = `${mentee}:${mentor}`;
      return usedPairs.has(pair1) || usedPairs.has(pair2);
    };
  
    // ペアを使用済みにする
    const markPairUsed = (mentor: string, mentee: string) => {
      usedPairs.add(`${mentor}:${mentee}`);
    };
  
  
    // 組み合わせ作成のヘルパー関数 (修正)
    const assignPair = (mentor: string, mentee: string): boolean => {
      if (mentor === mentee) return false; // 同じメンバー同士はペアにしない
      if (isExcluded([mentor, mentee], excludedList)) return false; // 除外リストに含まれる組み合わせは避ける
      if (isPairUsed(mentor, mentee)) return false; // すでに使用済みのペアは避ける
  
      // 最近実施した組み合わせ（とその逆）を避ける
      const recentMentorPair = getRecentPair(mentor, pastMonths);
      const recentMenteePair = getRecentPair(mentee, pastMonths);
  
      if (recentMentorPair && recentMentorPair.mentee === mentee) return false; // 直近で同じペア
      if (recentMenteePair && recentMenteePair.mentor === mentor) return false; // 直近で役割逆転ペア
  
      assignments.push({ mentor, mentee });
      availableMentors.splice(availableMentors.indexOf(mentor), 1);
      availableMentees.splice(availableMentees.indexOf(mentee), 1);
      markPairUsed(mentor, mentee); // ペアを使用済みにマーク
      return true;
    };
  
    // 過去の組み合わせを時系列順に取得し、最も最近のペアを反転させるロジック
    for (const member1 of members) {
      for (const member2 of members) {
        if (member1 === member2) continue;
        const pastDirectPairs = getPastPairs([member1, member2], pastMonths);
        if (pastDirectPairs.length > 0) {
          const mostRecentPair = pastDirectPairs[pastDirectPairs.length - 1]; // 最も最近のペア
          if (mostRecentPair.mentor === member1) {
            // 最も最近のペアが member1-member2 (mentor-mentee) なら mentee-mentor (member2-member1) を優先
            if (availableMentors.includes(member2) && availableMentees.includes(member1)) {
              if (assignPair(member2, member1)) continue; // 反転ペアを試行
            }
          }
        }
      }
    }
  
  
    // メンター候補とメンティー候補から総当たりで組み合わせを試みる (残りのメンバーでペアを作成)
    for (const mentor of members) {
      if (availableMentors.includes(mentor)) {
        for (const mentee of members) {
          if (availableMentees.includes(mentee)) {
            if (assignPair(mentor, mentee)) {
              break; // メンターが決まったら次のメンターへ
            }
          }
        }
      }
    }
  
    // ペアにならなかったメンバーをskipとする
    skip.push(...availableMentors, ...availableMentees);
  
    return { assignments, skip };
  }
  
  
  async function main() {
    if (Deno.args.length !== 1) {
      console.log("使用方法: deno run peer-1on1.ts <input.json>");
      Deno.exit(1);
    }
  
    const inputFilePath = Deno.args[0];
    const inputData = await readInput(inputFilePath);
    if (!inputData) {
      Deno.exit(1);
    }
  
    const currentMonth = new Date().getFullYear() + "年" + (new Date().getMonth() + 1) + "月"; // 例: "2024年1月"
    console.log(`\n========== ${currentMonth} の組み合わせ作成 ==========`);
  
    const { assignments, skip } = createAssignments(inputData.members, inputData.excluded, inputData.months);
  
    const newMonthData: MonthData = {
      month: currentMonth,
      skip: skip.length > 0 ? skip.join(", ") : null,
      assignments: assignments,
    };
  
    inputData.months.push(newMonthData);
  
    const outputJson = JSON.stringify(inputData, null, "  ");
    console.log(outputJson);
  }
  
  await main();
