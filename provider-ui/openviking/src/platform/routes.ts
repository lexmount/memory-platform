import { Route as root } from '#/routes/__root'
import { Route as Filesystem } from '#/routes/filesystem/route'
import { Route as Retrieval } from '#/routes/retrieval/route'
import { Route as Skills } from '#/routes/skills/route'
import { Route as Tasks } from '#/routes/tasks/route'
import { Route as Watches } from '#/routes/watches/route'
import { Route as Home } from '#/routes/home/route'
import { Route as Logs } from '#/routes/request-logs/route'
import { Route as Experience } from '#/routes/agent-experience/route'
import { Route as Compile } from '#/routes/compile/index'
import { Route as CompileNew } from '#/routes/compile/new'
import { Route as CompileTask } from '#/routes/compile/tasks/$taskId'
import { Route as ExperienceIndex } from '#/routes/agent-experience/index'
import { Route as ExperienceDetail } from '#/routes/agent-experience/$experienceUri'
export const routeTree = root.addChildren([
 Filesystem.update({id:'/filesystem',path:'/filesystem',getParentRoute:()=>root} as any),
 Retrieval.update({id:'/retrieval',path:'/retrieval',getParentRoute:()=>root} as any),
 Skills.update({id:'/skills',path:'/skills',getParentRoute:()=>root} as any),
 Tasks.update({id:'/tasks',path:'/tasks',getParentRoute:()=>root} as any),
 Watches.update({id:'/watches',path:'/watches',getParentRoute:()=>root} as any),
 Home.update({id:'/home',path:'/home',getParentRoute:()=>root} as any),
 Logs.update({id:'/request-logs',path:'/request-logs',getParentRoute:()=>root} as any),
 Compile.update({id:'/compile/',path:'/compile/',getParentRoute:()=>root} as any),
 CompileNew.update({id:'/compile/new',path:'/compile/new',getParentRoute:()=>root} as any),
 CompileTask.update({id:'/compile/tasks/$taskId',path:'/compile/tasks/$taskId',getParentRoute:()=>root} as any),
 Experience.update({id:'/agent-experience',path:'/agent-experience',getParentRoute:()=>root} as any).addChildren([ExperienceIndex.update({id:'/',path:'/',getParentRoute:()=>Experience} as any),ExperienceDetail.update({id:'/$experienceUri',path:'/$experienceUri',getParentRoute:()=>Experience} as any)]),
])
