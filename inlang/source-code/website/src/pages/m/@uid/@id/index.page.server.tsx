import { registry } from "@inlang/marketplace-registry"
import { convert } from "@inlang/markdown"
import type { PageContext } from "#src/renderer/types.js"
import type { PageProps } from "./index.page.jsx"
import type { MarketplaceManifest } from "@inlang/marketplace-manifest"
import fs from "node:fs/promises"
import { redirect } from "vike/abort"

const repositoryRoot = import.meta.url.slice(0, import.meta.url.lastIndexOf("inlang/source-code"))

async function fileExists(path: string): Promise<boolean> {
	try {
		// Check if it's a remote URL
		if (path.startsWith("http")) {
			const response = await fetch(path, { method: "HEAD" })
			return response.ok
		} else {
			// Check if it's a local file
			await fs.access(new URL(path, repositoryRoot))
			return true
		}
	} catch (error) {
		return false
	}
}

export async function onBeforeRender(pageContext: PageContext) {
	const item = registry.find(
		(item: any) => item.uniqueID === pageContext.routeParams.uid
	) as MarketplaceManifest & { uniqueID: string }

	if (!item) throw redirect("/m/404")

	if (item.id.replaceAll(".", "-").toLowerCase() !== pageContext.routeParams.id?.toLowerCase()) {
		throw redirect(`/m/${item.uniqueID}/${item.id.replaceAll(".", "-").toLowerCase()}`)
	}

	const readme = () => {
		return typeof item.readme === "object" ? item.readme.en : item.readme
	}

	const changelog = async () => {
		const changelogPath = readme().replace(/\/[^/]*$/, "/CHANGELOG.md")

		if (await fileExists(changelogPath)) {
			return changelogPath
		} else {
			return undefined
		}
	}

	const text = (path: string) =>
		path.includes("http")
			? fetch(path).then((res) => res.text())
			: fs.readFile(new URL(path, repositoryRoot)).then((res) => res.toString())

	const readmeMarkdown = await convert(await text(readme()))
	const changelogPath = await changelog()

	const changelogMarkdown = changelogPath ? await convert(await text(changelogPath)) : undefined

	const recommends = item.recommends
		? registry.filter((i: any) => {
				for (const recommend of item.recommends!) {
					if (recommend.replace("m/", "") === i.uniqueID) return true
				}
				return false
		  })
		: undefined

	return {
		pageContext: {
			pageProps: {
				readme: readmeMarkdown,
				changelog: changelogMarkdown,
				manifest: item,
				recommends: recommends,
			} as PageProps,
		},
	}
}
