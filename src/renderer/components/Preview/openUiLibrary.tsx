import { createLibrary, defineComponent } from '@openuidev/react-lang'
import * as z from 'zod/v4'

import { Box, ColFlex, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cherrystudio/ui'

const Text = defineComponent({
  name: 'Text',
  description: 'Plain text. HTML and Markdown are displayed as text.',
  props: z.object({ text: z.string() }),
  component: ({ props }) => <p className="whitespace-pre-wrap!">{props.text}</p>
})

const Metric = defineComponent({
  name: 'Metric',
  description: 'A named value with a short description.',
  props: z.object({ label: z.string(), value: z.union([z.string(), z.number()]), description: z.string() }),
  component: ({ props }) => (
    <Box className="rounded-lg border border-border bg-card p-3 text-card-foreground">
      <dl>
        <dt className="text-sm text-muted-foreground">{props.label}</dt>
        <dd className="text-xl font-medium">{props.value}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">{props.description}</p>
    </Box>
  )
})

const DataTable = defineComponent({
  name: 'DataTable',
  description: 'A table of text or numeric cells. Each row has one cell per column.',
  props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))) }),
  component: ({ props }) => (
    <Table>
      <TableHeader>
        <TableRow>
          {props.columns?.map((column, index) => (
            <TableHead key={index}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows?.map((row, index) => (
          <TableRow key={index}>
            {row.map((cell, cellIndex) => (
              <TableCell key={cellIndex}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
})

const Panel = defineComponent({
  name: 'Panel',
  description: 'The root container. Shows a title and a vertical list of content.',
  props: z.object({
    title: z.string(),
    children: z.array(z.union([Text.ref, Metric.ref, DataTable.ref]))
  }),
  component: ({ props, renderNode }) => (
    <ColFlex className="gap-3">
      <h3 className="text-base font-medium">{props.title}</h3>
      {renderNode(props.children)}
    </ColFlex>
  )
})

export const openUiLibrary = createLibrary({
  root: 'Panel',
  components: [Panel, Text, Metric, DataTable]
})
