import type { Request } from 'express'
import type { NoviUser } from './noviUser.js'

interface IRequest extends Request {
    noviUser?: NoviUser | undefined
}

export type { IRequest };
