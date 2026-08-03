FROM apify/actor-node-playwright-chrome:20

COPY --chown=myuser:myuser package.json ./
RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional \
 && echo "Installed:" && (npm list --omit=dev --all || true)

COPY --chown=myuser:myuser . ./

CMD ["node", "main.mjs"]
