/**
 * Quality budget: `selection_screen_call_cost` (owner: courses-api).
 * Target: no post enumeration on the selection-screen call; one count per course.
 *
 * APPLY-K. `GET /courses` ran `enumeratePosts` inside the course loop — two
 * paginated drains plus an attachment query plus a rubric query for EVERY course
 * the teacher owns — purely to render `postCount`. A 30-course teacher paid 60+
 * paginated scans to see a list of names, on the first authenticated call the
 * app makes, and no budget covered it: `perf-f4` measures the engine only.
 *
 * The second assertion matters as much as the first: a cheap count that
 * disagrees with the scan would just move the bug. The count must equal what the
 * enumerator would have produced.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { buildApp } from '../../src/app.js'
import { MockClassroomProvider } from '../../src/adapters/mock/mock-classroom-provider.js'
import type { ClassroomProvider } from '../../src/adapters/classroom-provider.interface.js'
import { enumeratePosts } from '../../src/services/post-enumerator.js'
import { createTestDb, type TestDb } from '../helpers/db.js'

let db: TestDb
let app: Express
let calls: Record<string, number>
let provider: ClassroomProvider

beforeEach(async () => {
  db = await createTestDb()
  const mock = new MockClassroomProvider(db.prisma)
  calls = { listCourses: 0, listCourseWork: 0, listCourseWorkMaterials: 0, countPosts: 0 }
  provider = new Proxy(mock, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function' || typeof prop !== 'string') return value
      return (...args: unknown[]) => {
        if (prop in calls) calls[prop] = (calls[prop] ?? 0) + 1
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as ClassroomProvider
  app = buildApp({ prisma: db.prisma, provider }).app
})
afterEach(async () => {
  await db.dispose()
})

describe('[budget] selection_screen_call_cost', () => {
  it('enumerates NOTHING and counts once per course', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/sign-in').send({ accountId: 'acct-jamie' }).expect(200)

    const res = await agent.get('/api/courses?role=source').expect(200)
    const courses = res.body.courses as { id: string; postCount: number }[]
    console.log(
      `[budget] selection screen: courses=${courses.length} listCourses=${calls.listCourses} ` +
        `countPosts=${calls.countPosts} listCourseWork=${calls.listCourseWork} ` +
        `listCourseWorkMaterials=${calls.listCourseWorkMaterials}`,
    )

    expect(courses.length).toBeGreaterThan(1)
    expect(calls.listCourseWork, 'the selection screen still drains coursework pages').toBe(0)
    expect(calls.listCourseWorkMaterials).toBe(0)
    expect(calls.countPosts).toBe(courses.length)
  })

  it('reports the SAME number the scan would', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/sign-in').send({ accountId: 'acct-jamie' }).expect(200)
    const res = await agent.get('/api/courses?role=source').expect(200)

    for (const course of res.body.courses as { id: string; postCount: number }[]) {
      const { posts } = await enumeratePosts(provider, course.id)
      expect(course.postCount, `postCount disagrees with the enumerator for ${course.id}`).toBe(
        posts.length,
      )
    }
  })
})
