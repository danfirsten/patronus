# The challenge and how we're judged

Copied from the official NASA Space Apps 2026 pages on Nov 14, 2026. Re-check the live pages before relying on dates or rules.

- Challenge: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/
- Judging & Awards Guide: https://www.spaceappschallenge.org/resources/judging-awards-guide/

---

## Be An Earth System Trend Detective!

Category: **Advanced**. Skills: Earth Science, Software.

### Summary
Change is always occurring in the Earth's interconnected environmental system, and when it runs in a consistent direction (rising or falling, increasing or decreasing, thickening or thinning) measured variables reflect it. But a measured Earth science data variable can trend one way in one region and the opposite way in another, even when the same process drives both. The multitude of Earth science data variables makes it difficult to select variables that could indicate change, and to then perform an analysis on the selected variables. Your challenge is to create a tool that can select variables measured by Earth science missions or produced by Earth science models, visualize how they change over time, and determine what is changing, where it is changing, how much it is changing, and if these changes are what scientists call "significant."

### Background
Instruments on satellites observe many different aspects of the Earth system: on land, in the atmosphere, and in the oceans. Global models also use satellite instrument data and other kinds of data to examine and analyze the Earth system. One important reason for doing this is to observe and characterize changes in the Earth system. Changes, especially those moving in a particular direction over time (a trend), indicate both the processes causing such changes and the processes that will respond to them.

One complicating factor in this work is the wide variety of variables that can be studied. Another is that changes in a particular variable can move in one direction in one region and in the opposite direction in another, even when both trends are caused by the same process! So there are two important parts to this problem: finding variables that are trending, from simple ones like temperature and rainfall to more complex ones like evaporation or streamflow; and analyzing trends in particular regions of the land, ocean, or even levels of the atmosphere.

Instruments such as the Moderate Resolution Imaging Spectroradiometer (MODIS), the Ozone Monitoring Instrument (OMI), the Atmospheric Infrared Sounder (AIRS), and the Global Precipitation Measurement (GPM) provide analyzable variables. Global models, notably the Modern Era Retrospective analysis for Research and Applications, Version 2 (MERRA-2) and the Global Land Data Assimilation System (GLDAS), provide many more. Finding, analyzing, and relating significant trends to the processes causing them is one of the most important uses of NASA Earth science data.

### Objectives
A successful response to this challenge will bring together several important elements.

1. Identify Earth science variables of interest that can be investigated for potential trends. NASA and other space agencies offer numerous variables, some familiar and some more specialized for use by particular branches of science.
2. Acquire the data variables for a particular region, since most trends in the data will not be global (though some trends can be!).
3. Generate and visualize a time series for the variable and region of interest over a long enough period of time to allow statistical analysis.
4. Perform a basic statistical analysis of that time series, indicating the rate of change over time, and test the trend's significance using methods such as a t-test, the Mann-Kendall test, or confidence intervals.

Data sites offer tools that generate time series, and statistical analysis packages provide basic significance testing. **A response that does both the visualization and the analysis meets the full scope of this challenge.**

### Potential considerations (optional)
**Audience.** This challenge involves science data and statistical analysis, so the likely audience is high school and college students, along with members of the public who have some scientific background. Providing simple definitions of the variables would help these users considerably. The concept is to help the users become data detectives: finding variables of interest, then determining whether those variables show a trend and whether that trend is significant.

**Approach.** Users could potentially respond to a short series of questions about what or where they would like to investigate, and then the answers to the questions would allow searching of related data variables. It would be highly useful to provide a couple of demonstration examples that the user could watch and would help them understand how the tool works. While not required, AI could be useful here to identify data with the potential to show trends in particular areas, drawing on either news articles and research papers or the characteristics of a region such as a desert, rain forest, tidal estuary, or the atmosphere above a large city.

**Working with the data.** Earth science data are available at several different temporal resolutions: hourly, 3-hourly, daily, and monthly. For this challenge, daily and monthly data are likely the easiest to process. Finding a trend is interesting even if it doesn't reach the level of significance. Sometimes all a trend needs to become significant is a longer period for the data to be acquired. Consider looking for publicly available tools for plotting hydrological data offered by outside organizations like CUAHSI. Trend analysis with Earth science data can be complex. Trends can be non-linear, and some are not evident unless regular cycles, such as the seasonal cycle, are removed. More complex trend analyses are beyond the scope envisioned for this challenge; detecting and analyzing linear trends would be a great start.

### Resources listed on the challenge page
NASA:
- **Giovanni**: menus of many data variables; generates and downloads time series.
- **Hydrology Time Series**: time series of hydrological data.
- **AppEEARS**: access and transform geospatial data from federal archives, including time series.
- **Climate Data Online (CDO)**: NCDC's archive of global historical weather and climate data, with a mapping tool.
- Research article: time-series analysis of SeaWiFS chlorophyll in river-influenced coastal regions (time series plus significance testing).

Space agency partners and other:
- **KNMI Climate Explorer**: web tool to explore, analyze and visualize climate data.
- Articles: statistical test methods to detect trends in time series; a guide to statistical significance.
- CSA: RADARSAT Constellation Mission data, Geo.ca, SWOT mission information, ecosystem monitoring from space, a SAR Python tutorial.

---

## Judging

Every level of judging (local, universal, global, executive) scores each project **1 to 5** on five criteria:

| Criterion | What a 5 looks like |
|---|---|
| **Impact** | Addresses a significant problem; extensive reach; benefits a large audience or could change the world. |
| **Creativity** | Original, groundbreaking approach that challenges conventional methods. |
| **Validity** | Scientifically sound and technically feasible; fully developed; usable and user-friendly. |
| **Relevance** | Thoroughly engages with **this** challenge; **NASA data is integral**, not superficial. |
| **Presentation** | Well-structured, compelling story: the challenge, the solution and why it matters. Judges use the demo **and** the full project page. |

The guide stresses that presentation counts as much as the other four.

### Eligibility and submission (minimum requirements)
- Respond to one official 2026 challenge.
- All members registered for the **same** local event (not waitlisted) and listed on the team's Members tab. 1–6 members for a local event. No new members after submission closes.
- Complete every required field on the Project Submission page.
- **Demo:** a slide deck of **at most 7 slides** (including title and intro) **or** a video of **at most 30 seconds**.
- **English** on the project page and all linked materials. A video may be in another language only with English subtitles.
- Submit from the team page's Project tab (edit, then "submit") **before Sun Nov 15, 2026, 11:59 PM local time** of the local event.
- Tick both checkboxes: agreement to the Submission Guide, terms and privacy policy; and confirmation that the work is original and **every external resource (code, text, images, even open source) is listed in the References field**, with no copyrighted material used without permission.
- Teams are reviewed for prohibited bilateral activity with China or Chinese-owned entities.

Not covered here, and still to check on the separate Project Submission Guide: AI-use disclosure wording, watermarking of AI images or video, and the rules on NASA branding.

### Phases and dates
1. **Local judging.** Local judges pick Global Nominees. Announced **Dec 3, 2026**.
2. **Global judging.** Expert judges pick Global Finalists and Honorable Mentions. Announced **Dec 17, 2026**.
3. **Executive judging.** NASA and partner-agency executives pick Global Winners. Announced **Jan 26, 2027**.

### Global awards
- Best Use of Science: best, most valid use of the scientific method.
- Best Use of Data: makes space data accessible or uses it in a unique application.
- Best Use of Technology: most innovative use of technology.
- Galactic Impact: most potential to improve life on Earth or in the universe.
- Best Mission Concept: most plausible concept and design.
- Most Inspirational: captures our hearts.
- Best Storytelling: most creatively communicates the potential of open data through storytelling.
- Global Connection: best connects people around the world through technology.
- Art & Technology: best combines technical and creative skills.
- Local Impact: greatest potential to make a difference in the team's local community.

Our targets (from `DESIGN.md`): Best Use of Data, Best Use of Science, Galactic Impact, Best Storytelling.
