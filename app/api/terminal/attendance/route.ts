Failed to compile.
./app/api/terminal/attendance/route.ts
Error: 
  x Expected '>', got 'className'
     ,-[/vercel/path0/app/api/terminal/attendance/route.ts:332:1]
 332 |         : `勤務時間合計（${staffList.find((s) => s.id === staffSelectValue)?.displayName ?? "スタッフ"}）`;
 333 | 
 334 |     return (
 335 |       <div className="space-y-8">
     :            ^^^^^^^^^
 336 |         <h1 className="text-2xl font-semibold text-pink-300">勤怠管理</h1>
 337 | 
 338 |         <Card>
     `----
Caused by:
    Syntax Error
Import trace for requested module:
./app/api/terminal/attendance/route.ts
> Build failed because of webpack errors
Error: Command "npm run vercel-build" exited with 1
