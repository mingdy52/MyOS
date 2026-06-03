// 노션 리더들을 한곳에 모으는 배럴 파일.
import { getTargets } from "./target.js";
import { getDietRecords } from "./diet.js";
import { getWorkoutRecords } from "./workout.js";
import { getStudyRecords } from "./study.js";
import { getExpenses } from "./expense.js";
import { getDiaryRecords } from "./diary.js";
import { getWeightRecords } from "./weight.js";

import { getTechStacks } from "./techstack.js";
import { getProjects } from "./project.js";
import { getApplications } from "./application.js";

export { 
  getTargets, 
  getDietRecords, 
  getWorkoutRecords,
  getStudyRecords, 
  getExpenses, 
  getDiaryRecords,
  getWeightRecords,
  getTechStacks,
  getProjects,
  getApplications,
};

// 모든 데이터를 한 번에 가져온다.
export async function getAllData() {
  const [targets, diet, workout, study, expenses, diary, weight, techStacks, projects, applications] = await Promise.all([
    getTargets(),
    getDietRecords(),
    getWorkoutRecords(),
    getStudyRecords(),
    getExpenses(),
    getDiaryRecords(),
    getWeightRecords(),
    getTechStacks(),
    getProjects(),
    getApplications(),
  ]);

  return { expenses, diet, workout, study, targets, diary, weight, techStacks, projects, applications };
}
