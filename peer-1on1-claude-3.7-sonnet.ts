#!/usr/bin/env -S deno run --allow-read

// peer-1on1: Command-line tool for generating mentor-mentee pairs for monthly 1-on-1 sessions
// Usage: deno run --allow-read peer-1on1.ts <input-file.json> > <output-file.json>

interface Assignment {
  mentor: string;
  mentee: string;
}

interface Month {
  month: string;
  skip: string[];
  assignments: Assignment[];
}

interface InputData {
  members: string[];
  excluded: string[][];
  months: Month[];
}

/**
 * Check if a pair is excluded based on the excluded list
 */
function isPairExcluded(mentor: string, mentee: string, excluded: string[][]): boolean {
  return excluded.some(pair => 
    (pair[0] === mentor && pair[1] === mentee) || 
    (pair[0] === mentee && pair[1] === mentor)
  );
}

/**
 * Check if this is a recent pairing (in last month)
 */
function isRecentPairing(mentor: string, mentee: string, previousMonth: Month | null): boolean {
  if (!previousMonth) return false;
  
  return previousMonth.assignments.some(assignment => 
    (assignment.mentor === mentor && assignment.mentee === mentee) ||
    (assignment.mentor === mentee && assignment.mentee === mentor)
  );
}

/**
 * Generate a score for a potential pairing (lower is better)
 */
function getPairingScore(
  mentor: string, 
  mentee: string, 
  pairingHistory: Record<string, Record<string, number>>,
  previousMonth: Month | null
): number {
  // Start with the number of times they've been paired
  let score = pairingHistory[mentor][mentee] || 0;
  
  // Heavily penalize recent pairings
  if (isRecentPairing(mentor, mentee, previousMonth)) {
    score += 100;
  }
  
  return score;
}

/**
 * Generate a new month's assignments
 */
function generateNewAssignments(
  members: string[],
  excluded: string[][],
  months: Month[]
): {
  assignments: Assignment[];
  skip: string[];
} {
  // Create a matrix to track pairing history
  const pairingHistory: Record<string, Record<string, number>> = {};
  members.forEach(mentor => {
    pairingHistory[mentor] = {};
    members.forEach(mentee => {
      if (mentor !== mentee) {
        pairingHistory[mentor][mentee] = 0;
      }
    });
  });
  
  // Count previous pairings
  months.forEach(month => {
    month.assignments.forEach(assignment => {
      if (
        pairingHistory[assignment.mentor] && 
        pairingHistory[assignment.mentor][assignment.mentee] !== undefined
      ) {
        pairingHistory[assignment.mentor][assignment.mentee]++;
      }
      if (
        pairingHistory[assignment.mentee] && 
        pairingHistory[assignment.mentee][assignment.mentor] !== undefined
      ) {
        pairingHistory[assignment.mentee][assignment.mentor]++;
      }
    });
  });
  
  // Get previous month for recency checking
  const previousMonth = months.length > 0 ? months[months.length - 1] : null;
  
  // Available members (not skipped in previous month)
  const availableMembers = [...members];
  
  // Track assignments and skipped members
  const assignments: Assignment[] = [];
  const usedMembers = new Set<string>();
  const skip: string[] = [];
  
  // Keep track of possible pairings for each member
  const possiblePairings: Record<string, Array<{mentee: string, score: number}>> = {};
  
  // Build possible pairings for each member with scores
  availableMembers.forEach(mentor => {
    possiblePairings[mentor] = [];
    
    availableMembers.forEach(mentee => {
      // Skip self-pairing or excluded pairs
      if (mentor === mentee || isPairExcluded(mentor, mentee, excluded)) {
        return;
      }
      
      const score = getPairingScore(mentor, mentee, pairingHistory, previousMonth);
      possiblePairings[mentor].push({ mentee, score });
    });
    
    // Sort by score (lower is better)
    possiblePairings[mentor].sort((a, b) => a.score - b.score);
  });
  
  // First, assign members with fewest options
  const membersByOptionCount = [...availableMembers]
    .sort((a, b) => 
      possiblePairings[a].filter(p => !usedMembers.has(p.mentee)).length - 
      possiblePairings[b].filter(p => !usedMembers.has(p.mentee)).length
    );
  
  for (const mentor of membersByOptionCount) {
    if (usedMembers.has(mentor)) continue;
    
    // Filter valid mentees (not used yet and not excluded)
    const validMentees = possiblePairings[mentor]
      .filter(p => !usedMembers.has(p.mentee));
    
    if (validMentees.length === 0) {
      // No valid mentees, add to skip list
      skip.push(mentor);
      usedMembers.add(mentor);
      continue;
    }
    
    // Check if the best pairing is the same as last month
    let selectedPairing = validMentees[0];
    
    // If the pairing is identical to previous month, reverse the roles if possible
    if (previousMonth && previousMonth.assignments.some(a => 
        a.mentor === mentor && a.mentee === selectedPairing.mentee)) {
      // Try to reverse roles
      if (!usedMembers.has(selectedPairing.mentee) && 
          !isPairExcluded(selectedPairing.mentee, mentor, excluded)) {
        assignments.push({
          mentor: selectedPairing.mentee,
          mentee: mentor
        });
        usedMembers.add(mentor);
        usedMembers.add(selectedPairing.mentee);
        continue;
      }
      
      // If we can't reverse roles, try the next best pairing
      if (validMentees.length > 1) {
        selectedPairing = validMentees[1];
      }
    }
    
    // Assign the best available mentee
    assignments.push({
      mentor,
      mentee: selectedPairing.mentee
    });
    usedMembers.add(mentor);
    usedMembers.add(selectedPairing.mentee);
  }
  
  // Handle any unassigned members (should be added to skip)
  availableMembers.forEach(member => {
    if (!usedMembers.has(member)) {
      skip.push(member);
    }
  });
  
  return { assignments, skip };
}

/**
 * Get the current year and month in the required format
 */
function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月`;
}

/**
 * Main function to process the input and generate assignments
 */
async function main() {
  try {
    // Check if input file is provided
    if (Deno.args.length < 1) {
      console.error("Usage: deno run --allow-read peer-1on1.ts <input-file.json>");
      Deno.exit(1);
    }

    // Read input file
    const inputFile = Deno.args[0];
    const inputText = await Deno.readTextFile(inputFile);
    const inputData: InputData = JSON.parse(inputText);
    
    // Validate input
    if (!inputData.members || !Array.isArray(inputData.members)) {
      throw new Error("Input must contain a 'members' array");
    }
    
    if (!inputData.excluded || !Array.isArray(inputData.excluded)) {
      inputData.excluded = [];
    }
    
    if (!inputData.months || !Array.isArray(inputData.months)) {
      inputData.months = [];
    }
    
    // Generate new month's assignments
    const { assignments, skip } = generateNewAssignments(
      inputData.members,
      inputData.excluded,
      inputData.months
    );
    
    // Create the new month entry
    const newMonth: Month = {
      month: getCurrentYearMonth(),
      skip,
      assignments,
    };
    
    // Add the new month to the data
    inputData.months.push(newMonth);
    
    // Output the updated data
    console.log(JSON.stringify(inputData, null, 2));
    
  } catch (error) {
    console.error("Error:", error.message);
    Deno.exit(1);
  }
}

// Run the main function
if (import.meta.main) {
  main();
}
