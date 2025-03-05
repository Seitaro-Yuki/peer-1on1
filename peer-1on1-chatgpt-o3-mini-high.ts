#!/usr/bin/env -S deno run --allow-read

// ----- 型定義 -----
// メンター・メンティのペアを表す型
interface Assignment {
  mentor: string; // メンター
  mentee: string; // メンティ
}

// 月ごとの情報
interface Month {
  month: string;              // 例："2021年10月"
  skip?: string | string[];   // ペアリング対象から除外するメンバー（任意）
  assignments?: Assignment[]; // その月のペアリング結果
  extraSkip?: string | string[]; // ペアリングできなかった（余った）メンバー
}

// 入力全体のデータ型
interface InputData {
  members: string[];                // 全メンバー
  excluded?: [string, string][];      // 除外する組み合わせ（[A, B] は "A|B" と "B|A" 両方を除外対象）
  months: Month[];                  // 過去の月情報（時系列順）
}

// ペアリング生成結果
interface AssignmentResult {
  assignments: Assignment[]; // 生成されたペアリング
  extraSkip: string[];       // ペアリングできなかったメンバー
}

// ----- 月文字列の解析・整形 -----
// "YYYY年MM月" の文字列を解析して {year, month} を返す
function parseMonth(monthStr: string): { year: number; month: number } | null {
  const match = monthStr.match(/(\d+)年(\d+)月/);
  if (!match) return null;
  return { year: parseInt(match[1], 10), month: parseInt(match[2], 10) };
}

// 年と月の数値から "YYYY年MM月" の形式の文字列を生成する
function formatMonth(year: number, month: number): string {
  return `${year}年${month}月`;
}

// ----- ユーティリティ関数 -----
// 配列をランダムにシャッフルする関数
function shuffleArray<T>(array: T[]): T[] {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// eligible なメンバーから候補となるペアリングを生成する
function generateCandidate(eligible: string[]): Assignment[] {
  const shuffled = shuffleArray(eligible);
  const half = shuffled.length / 2;
  const candidate: Assignment[] = [];
  for (let i = 0; i < half; i++) {
    candidate.push({
      mentor: shuffled[i],
      mentee: shuffled[i + half],
    });
  }
  return candidate;
}

// 2つのペアリング配列が全く同じペアの集合かチェックする（順序は問わない）
function isSamePairing(a1: Assignment[], a2: Assignment[]): boolean {
  if (a1.length !== a2.length) return false;
  const set1 = new Set(a1.map(a => `${a.mentor}|${a.mentee}`));
  const set2 = new Set(a2.map(a => `${a.mentor}|${a.mentee}`));
  if (set1.size !== set2.size) return false;
  for (const pair of set1) {
    if (!set2.has(pair)) return false;
  }
  return true;
}

// 2つのペアリング配列間の重複数を数える
function countOverlap(a1: Assignment[], a2: Assignment[]): number {
  const set = new Set(a2.map(a => `${a.mentor}|${a.mentee}`));
  let count = 0;
  for (const a of a1) {
    if (set.has(`${a.mentor}|${a.mentee}`)) count++;
  }
  return count;
}

// ----- 除外組み合わせ関連 -----
// 入力の excluded 配列を "mentor|mentee" 形式の Set に変換する（両順序を除外対象）
function buildExcludedSet(excluded?: [string, string][]): Set<string> {
  const set = new Set<string>();
  if (!excluded) return set;
  for (const pair of excluded) {
    set.add(pair.join("|"));
    set.add(pair.slice().reverse().join("|"));
  }
  return set;
}

// 候補ペアリングに、除外組み合わせに含まれるペアがあるかチェックする
function candidateHasExcluded(candidate: Assignment[], excludedSet: Set<string>): boolean {
  for (const pair of candidate) {
    const key = `${pair.mentor}|${pair.mentee}`;
    if (excludedSet.has(key)) return true;
  }
  return false;
}

// ----- ペアリング生成 -----
// eligible なメンバーから、直近実施していない（なるべく最近使われていない）候補を生成する。
// ・除外組み合わせを回避する。
// ・過去全体および直近の月で実施されたペアにはペナルティを与える。
// ・eligible 数が奇数の場合は余ったメンバーを extraSkip に記録する。
function generateAssignments(
  members: string[],
  skip: string | undefined,
  prevAssignments: Assignment[] | undefined,
  excludedSet: Set<string>
): AssignmentResult {
  // skip 指定があれば除外
  let eligible = skip ? members.filter(m => m !== skip) : members.slice();
  const extraSkipped: string[] = [];

  // eligible 数が奇数の場合、ランダムに1名除外して extraSkipped に追加
  if (eligible.length % 2 !== 0) {
    const index = Math.floor(Math.random() * eligible.length);
    extraSkipped.push(eligible[index]);
    eligible.splice(index, 1);
  }

  const attempts = 1000;
  let bestCandidate: Assignment[] | null = null;
  let bestPenalty = Infinity;

  // 過去全体のペアリング（すべての月の assignments）をセットにする
  const pastSet = new Set<string>();
  for (const m of data.months) {
    if (m.assignments) {
      for (const a of m.assignments) {
        pastSet.add(`${a.mentor}|${a.mentee}`);
      }
    }
  }

  // 候補生成の試行
  for (let i = 0; i < attempts; i++) {
    const candidate = generateCandidate(eligible);
    // 除外組み合わせに含まれるペアがあればスキップ
    if (candidateHasExcluded(candidate, excludedSet)) continue;
    let penalty = 0;
    // 過去全体で実施されたペアにはペナルティを加算
    for (const pair of candidate) {
      const key = `${pair.mentor}|${pair.mentee}`;
      if (pastSet.has(key)) penalty++;
    }
    // 直近の月との重複もペナルティに加算
    if (prevAssignments) {
      penalty += countOverlap(candidate, prevAssignments);
    }
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestCandidate = candidate;
      if (bestPenalty === 0) break;
    }
  }
  if (!bestCandidate) {
    // 有効な候補が見つからなかった場合、eligible からランダムに1名除外して再挑戦
    if (eligible.length === 0) return { assignments: [], extraSkip: extraSkipped };
    const index = Math.floor(Math.random() * eligible.length);
    extraSkipped.push(eligible[index]);
    eligible.splice(index, 1);
    return generateAssignments(members, skip, prevAssignments, excludedSet);
  }
  return { assignments: bestCandidate, extraSkip: extraSkipped };
}

// ----- 過去の組み合わせチェック＆反転 -----
// 過去の全月履歴（時系列順）から、
// 同じ組み合わせ（順序無視）のうち最も直近に実施された組み合わせを探し、
// もし新たな候補がその直近の組み合わせと「同じ順序」であれば、
// そのペアのメンターとメンティを反転する（元から逆の場合はそのまま）。
function adjustAssignments(candidate: Assignment[], history: Month[]): Assignment[] {
  return candidate.map(pair => {
    const pairSet = new Set([pair.mentor, pair.mentee]);
    // 直近の履歴を後ろから調べる
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.assignments) {
        for (const a of m.assignments) {
          const aSet = new Set([a.mentor, a.mentee]);
          if (pairSet.size === aSet.size && [...pairSet].every(x => aSet.has(x))) {
            // 同じ組み合わせが見つかったら、直近の組み合わせが candidate と同じ順序なら反転する
            if (a.mentor === pair.mentor && a.mentee === pair.mentee) {
              // 反転後の組み合わせ
              const flipped = { mentor: pair.mentee, mentee: pair.mentor };
              // もし直近の組み合わせがすでに反転されている場合（＝新候補が flipped と同じなら）、何もしない
              if (a.mentor === flipped.mentor && a.mentee === flipped.mentee) {
                return pair;
              }
              return flipped;
            }
            // もし既に逆になっている場合はそのまま返す
            return pair;
          }
        }
      }
    }
    return pair;
  });
}

// ----- メイン処理 -----

// グローバル変数 data を利用するために宣言
let data: InputData;

async function main() {
  // コマンドライン引数チェック
  if (Deno.args.length < 1) {
    console.error("Usage: peer-1on1 <input.json>");
    Deno.exit(1);
  }
  const inputFilePath = Deno.args[0];

  // 入力 JSON の読み込みと解析
  try {
    const fileContent = await Deno.readTextFile(inputFilePath);
    data = JSON.parse(fileContent);
  } catch (err) {
    console.error("入力 JSON ファイルの読み込みまたは解析に失敗しました:", err);
    Deno.exit(1);
  }

  // 除外組み合わせを "mentor|mentee" 形式の Set に変換（両順序対象）
  const excludedSet = buildExcludedSet(data.excluded);

  if (!data.months || data.months.length === 0) {
    console.error("Error: 入力に月情報が含まれていません。");
    Deno.exit(1);
  }

  // 最新の月（months 配列の最後の要素）の月文字列を解析
  const lastMonth = data.months[data.months.length - 1];
  const parsed = parseMonth(lastMonth.month);
  if (!parsed) {
    console.error(`Error: 月文字列 "${lastMonth.month}" の解析に失敗しました。`);
    Deno.exit(1);
  }
  // 次の月を計算（例："2021年10月" の次は "2021年11月"、12月なら翌年の1月）
  let newYear = parsed.year;
  let newMonthNum = parsed.month + 1;
  if (newMonthNum > 12) {
    newYear++;
    newMonthNum = 1;
  }
  const newMonthStr = formatMonth(newYear, newMonthNum);

  // 履歴（時系列順の全月情報）を history として利用
  const history = data.months;

  // 直近の月（最新以外で assignments が設定されている最後の月）の assignments を取得
  let prevAssignments: Assignment[] | undefined = undefined;
  for (let i = data.months.length - 2; i >= 0; i--) {
    if (data.months[i].assignments) {
      prevAssignments = data.months[i].assignments;
      break;
    }
  }

  // 新しい月のペアリングを生成（新月では skip 指定は無視）
  const result = generateAssignments(data.members, undefined, prevAssignments, excludedSet);
  let newAssignments = result.assignments;

  // 過去の履歴から、同じ組み合わせ（順序無視）のうち最も直近に実施された組み合わせがあれば、
  // その組み合わせと同じ順序の場合は、新しいペアのメンターとメンティを反転する
  newAssignments = adjustAssignments(newAssignments, history);

  // 新しい月のオブジェクトを作成
  const newMonth: Month = {
    month: newMonthStr,
    assignments: newAssignments,
  };
  // ペアリングできなかった（余った）メンバーは skip（extraSkip）として記録
  if (result.extraSkip.length > 0) {
    newMonth.skip = result.extraSkip.length === 1 ? result.extraSkip[0] : result.extraSkip;
  }

  // 入力データに新しい月の情報を追加
  data.months.push(newMonth);

  // 結果の JSON を標準出力に出力
  console.log(JSON.stringify(data, null, 2));
}

main();
