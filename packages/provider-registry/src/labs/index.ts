/**
 * The lab registry — the single hand-maintained source for the model catalog.
 * One file per lab; `data/models.json` is generated from these (scripts/generate-catalog.ts).
 * Never edit models.json by hand.
 */
import lab_01ai from './01ai'
import ai21 from './ai21'
import alibaba from './alibaba'
import allenai from './allenai'
import amazon from './amazon'
import anthropic from './anthropic'
import arceeai from './arceeai'
import baai from './baai'
import baichuan from './baichuan'
import baidu from './baidu'
import bailing from './bailing'
import black_forest_labs from './black-forest-labs'
import bria from './bria'
import bytedance from './bytedance'
import cogito from './cogito'
import cohere from './cohere'
import deepseek from './deepseek'
import elevenlabs from './elevenlabs'
import google from './google'
import ideogram from './ideogram'
import inception from './inception'
import intern from './intern'
import jina from './jina'
import kling from './kling'
import liquidai from './liquidai'
import luma from './luma'
import meituan from './meituan'
import meta from './meta'
import microsoft from './microsoft'
import minimax from './minimax'
import mistral from './mistral'
import moonshot from './moonshot'
import nomic from './nomic'
import nousresearch from './nousresearch'
import nvidia from './nvidia'
import openai from './openai'
import perplexity from './perplexity'
import recraft from './recraft'
import reka from './reka'
import runway from './runway'
import sensetime from './sensetime'
import sentence_transformers from './sentence-transformers'
import stability from './stability'
import stepfun from './stepfun'
import streamlake from './streamlake'
import suno from './suno'
import tencent from './tencent'
import type { Lab } from './types'
import upstage from './upstage'
import vercel from './vercel'
import vidu from './vidu'
import voyage from './voyage'
import writer from './writer'
import xai from './xai'
import xiaomi from './xiaomi'
import zhipu from './zhipu'

export const LABS: Lab[] = [
  lab_01ai,
  ai21,
  alibaba,
  allenai,
  amazon,
  anthropic,
  arceeai,
  baai,
  baichuan,
  baidu,
  bailing,
  black_forest_labs,
  bria,
  bytedance,
  cogito,
  cohere,
  deepseek,
  elevenlabs,
  google,
  ideogram,
  inception,
  intern,
  jina,
  kling,
  liquidai,
  luma,
  meituan,
  meta,
  microsoft,
  minimax,
  mistral,
  moonshot,
  nomic,
  nousresearch,
  nvidia,
  openai,
  perplexity,
  recraft,
  reka,
  runway,
  sensetime,
  sentence_transformers,
  stability,
  stepfun,
  streamlake,
  suno,
  tencent,
  upstage,
  vercel,
  vidu,
  voyage,
  writer,
  xai,
  xiaomi,
  zhipu
]

export type { Lab, LabModel } from './types'
export { defineLab } from './types'
