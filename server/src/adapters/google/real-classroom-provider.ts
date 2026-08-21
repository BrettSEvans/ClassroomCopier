import { google } from 'googleapis'
import type {
  ClassroomProvider,
  Course,
  Topic,
  ClassworkPost,
  TransferRequest,
  TransferResult,
  PreFlightScanResult,
} from './classroom-provider.interface.js'

export class RealClassroomProvider implements ClassroomProvider {
  private getAuthClient(accessToken: string) {
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: accessToken })
    return auth
  }

  async listCourses(accessToken: string): Promise<Course[]> {
    const auth = this.getAuthClient(accessToken)
    const classroom = google.classroom({ version: 'v1', auth })

    const res = await classroom.courses.list({
      teacherId: 'me',
      courseStates: ['ACTIVE', 'ARCHIVED'],
    })

    const courses = res.data.courses ?? []
    return courses.map((c) => ({
      id: c.id ?? '',
      name: c.name ?? 'Untitled Course',
      section: c.section ?? undefined,
      courseState: (c.courseState as 'ACTIVE' | 'ARCHIVED') ?? 'ACTIVE',
      creationTime: c.creationTime ?? new Date().toISOString(),
    }))
  }

  async listTopics(accessToken: string, courseId: string): Promise<Topic[]> {
    const auth = this.getAuthClient(accessToken)
    const classroom = google.classroom({ version: 'v1', auth })

    const res = await classroom.topics.list({ courseId })
    const topics = res.data.topic ?? []

    return topics.map((t) => ({
      id: t.topicId ?? '',
      courseId: t.courseId ?? courseId,
      name: t.name ?? 'Untitled Topic',
    }))
  }

  async listClasswork(accessToken: string, courseId: string): Promise<ClassworkPost[]> {
    const auth = this.getAuthClient(accessToken)
    const classroom = google.classroom({ version: 'v1', auth })

    const [cwRes, matRes] = await Promise.all([
      classroom.courses.courseWork.list({ courseId }),
      classroom.courses.courseWorkMaterials.list({ courseId }),
    ])

    const rawCoursework = cwRes.data.courseWork ?? []
    const rawMaterials = matRes.data.courseWorkMaterial ?? []

    const posts: ClassworkPost[] = []

    for (const item of rawCoursework) {
      posts.push({
        id: item.id ?? '',
        courseId,
        title: item.title ?? 'Untitled Assignment',
        description: item.description ?? undefined,
        state: item.state as 'PUBLISHED' | 'DRAFT' | 'SCHEDULED',
        type: item.workType === 'MULTIPLE_CHOICE_QUESTION' || item.workType === 'SHORT_ANSWER_QUESTION' 
          ? 'QUESTION' 
          : 'ASSIGNMENT',
        topicId: item.topicId ?? undefined,
        maxPoints: item.maxPoints ?? undefined,
        creationTime: item.creationTime ?? new Date().toISOString(),
        updateTime: item.updateTime ?? new Date().toISOString(),
        attachments: (item.materials ?? []).map((m) => this.parseMaterial(m)),
      })
    }

    for (const item of rawMaterials) {
      posts.push({
        id: item.id ?? '',
        courseId,
        title: item.title ?? 'Untitled Material',
        description: item.description ?? undefined,
        state: item.state as 'PUBLISHED' | 'DRAFT' | 'SCHEDULED',
        type: 'MATERIAL',
        topicId: item.topicId ?? undefined,
        creationTime: item.creationTime ?? new Date().toISOString(),
        updateTime: item.updateTime ?? new Date().toISOString(),
        attachments: (item.materials ?? []).map((m) => this.parseMaterial(m)),
      })
    }

    return posts
  }

  async runPreFlightScan(
    accessToken: string,
    sourceCourseId: string,
    _targetCourseId: string
  ): Promise<PreFlightScanResult> {
    const posts = await this.listClasswork(accessToken, sourceCourseId)
    const issues: PreFlightScanResult['issues'] = []

    for (const post of posts) {
      for (const att of post.attachments) {
        if (att.type === 'DRIVE_FILE' && att.driveFile) {
          try {
            const drive = google.drive({ version: 'v3', auth: this.getAuthClient(accessToken) })
            const fileRes = await drive.files.get({
              fileId: att.driveFile.id,
              fields: 'id, name, trashed, explicitlyTrashed',
            })

            if (fileRes.data.trashed || fileRes.data.explicitlyTrashed) {
              issues.push({
                postId: post.id,
                postTitle: post.title,
                attachmentId: att.driveFile.id,
                attachmentTitle: att.driveFile.title ?? 'Drive File',
                type: 'TRASHED',
                recommendedAction: 'FALLBACK_SHELL_NOTE',
              })
            }
          } catch {
            issues.push({
              postId: post.id,
              postTitle: post.title,
              attachmentId: att.driveFile.id,
              attachmentTitle: att.driveFile.title ?? 'Drive File',
              type: 'PERMISSION_LOCKED',
              recommendedAction: 'FALLBACK_SHELL_NOTE',
            })
          }
        }
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
      scannedAt: new Date().toISOString(),
    }
  }

  async executeTransfer(accessToken: string, req: TransferRequest): Promise<TransferResult> {
    const auth = this.getAuthClient(accessToken)
    const classroom = google.classroom({ version: 'v1', auth })

    const sourceTopics = await this.listTopics(accessToken, req.sourceCourseId)
    const topicIdMap = new Map<string, string>()

    for (const topic of sourceTopics) {
      const createdTopic = await classroom.topics.create({
        courseId: req.targetCourseId,
        requestBody: { name: topic.name },
      })
      if (createdTopic.data.topicId) {
        topicIdMap.set(topic.id, createdTopic.data.topicId)
      }
    }

    const sourcePosts = await this.listClasswork(accessToken, req.sourceCourseId)
    sourcePosts.sort((a, b) => new Date(a.creationTime).getTime() - new Date(b.creationTime).getTime())

    let transferredCount = 0
    let fallbackCount = 0

    for (const post of sourcePosts) {
      const targetTopicId = post.topicId ? topicIdMap.get(post.topicId) : undefined
      let description = post.description ?? ''

      const materials = post.attachments.map((att) => {
        if (att.type === 'DRIVE_FILE' && att.driveFile) {
          return {
            driveFile: {
              driveFile: { id: att.driveFile.id, title: att.driveFile.title },
              shareMode: att.driveFile.shareMode ?? 'VIEW',
            },
          }
        }
        if (att.type === 'YOUTUBE' && att.youtube) {
          return { youtubeVideo: { id: att.youtube.id, title: att.youtube.title } }
        }
        if (att.type === 'LINK' && att.link) {
          return { link: { url: att.link.url, title: att.link.title } }
        }
        if (att.type === 'FORM' && att.form) {
          return { form: { formUrl: att.form.formUrl, title: att.form.title } }
        }
        return {}
      })

      try {
        if (post.type === 'MATERIAL') {
          await classroom.courses.courseWorkMaterials.create({
            courseId: req.targetCourseId,
            requestBody: {
              title: post.title,
              description,
              state: 'DRAFT',
              topicId: targetTopicId,
              materials,
            },
          })
        } else {
          await classroom.courses.courseWork.create({
            courseId: req.targetCourseId,
            requestBody: {
              title: post.title,
              description,
              state: 'DRAFT',
              workType: post.type === 'QUESTION' ? 'SHORT_ANSWER_QUESTION' : 'ASSIGNMENT',
              topicId: targetTopicId,
              maxPoints: post.maxPoints,
              materials,
            },
          })
        }
        transferredCount++
      } catch {
        fallbackCount++
        description += '\n\n[Classroom Copier Note: One or more attachments could not be auto-linked due to permissions.]'
        if (post.type === 'MATERIAL') {
          await classroom.courses.courseWorkMaterials.create({
            courseId: req.targetCourseId,
            requestBody: { title: post.title, description, state: 'DRAFT', topicId: targetTopicId },
          })
        } else {
          await classroom.courses.courseWork.create({
            courseId: req.targetCourseId,
            requestBody: {
              title: post.title,
              description,
              state: 'DRAFT',
              workType: 'ASSIGNMENT',
              topicId: targetTopicId,
            },
          })
        }
      }
    }

    return {
      success: true,
      summary: {
        topicsMapped: topicIdMap.size,
        postsTransferred: transferredCount,
        fallbacksCreated: fallbackCount,
      },
    }
  }

  private parseMaterial(m: any) {
    if (m.driveFile) {
      return {
        id: m.driveFile.driveFile?.id ?? '',
        type: 'DRIVE_FILE' as const,
        driveFile: {
          id: m.driveFile.driveFile?.id ?? '',
          title: m.driveFile.driveFile?.title ?? 'Drive File',
          alternateLink: m.driveFile.driveFile?.alternateLink,
          shareMode: m.driveFile.shareMode,
        },
      }
    }
    if (m.youtubeVideo) {
      return {
        id: m.youtubeVideo.id ?? '',
        type: 'YOUTUBE' as const,
        youtube: {
          id: m.youtubeVideo.id ?? '',
          title: m.youtubeVideo.title ?? 'YouTube Video',
          alternateLink: m.youtubeVideo.alternateLink,
        },
      }
    }
    if (m.link) {
      return {
        id: m.link.url ?? '',
        type: 'LINK' as const,
        link: {
          url: m.link.url ?? '',
          title: m.link.title ?? 'Link',
        },
      }
    }
    if (m.form) {
      return {
        id: m.form.formUrl ?? '',
        type: 'FORM' as const,
        form: {
          formUrl: m.form.formUrl ?? '',
          title: m.form.title ?? 'Google Form',
        },
      }
    }
    return { id: 'unknown', type: 'LINK' as const, link: { url: '', title: 'Unknown Attachment' } }
  }
}
