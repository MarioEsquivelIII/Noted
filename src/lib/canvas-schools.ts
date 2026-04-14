/**
 * Known Canvas LMS instances mapped to their Instructure domains.
 * This list covers major US universities. Students can also type a custom domain.
 *
 * Format: { name: display name, domain: Canvas instance URL }
 * Most schools use {subdomain}.instructure.com, some use custom domains.
 */

export interface CanvasSchool {
  name: string;
  domain: string;
}

export const CANVAS_SCHOOLS: CanvasSchool[] = [
  // Georgia (home school)
  { name: "Georgia Institute of Technology", domain: "gatech.instructure.com" },
  { name: "Georgia State University", domain: "gsu.instructure.com" },
  { name: "University of Georgia", domain: "uga.instructure.com" },
  { name: "Emory University", domain: "canvas.emory.edu" },
  { name: "Georgia Southern University", domain: "georgiasouthern.instructure.com" },
  { name: "Kennesaw State University", domain: "kennesaw.instructure.com" },
  { name: "Augusta University", domain: "augusta.instructure.com" },

  // Top US universities
  { name: "MIT", domain: "canvas.mit.edu" },
  { name: "Stanford University", domain: "canvas.stanford.edu" },
  { name: "Harvard University", domain: "canvas.harvard.edu" },
  { name: "Carnegie Mellon University", domain: "canvas.cmu.edu" },
  { name: "UC Berkeley", domain: "bcourses.berkeley.edu" },
  { name: "Caltech", domain: "canvas.caltech.edu" },
  { name: "Princeton University", domain: "canvas.princeton.edu" },
  { name: "Cornell University", domain: "canvas.cornell.edu" },
  { name: "University of Michigan", domain: "umich.instructure.com" },
  { name: "UIUC", domain: "canvas.illinois.edu" },
  { name: "UT Austin", domain: "utexas.instructure.com" },
  { name: "Columbia University", domain: "courseworks2.columbia.edu" },
  { name: "University of Pennsylvania", domain: "canvas.upenn.edu" },
  { name: "Yale University", domain: "canvas.yale.edu" },
  { name: "Duke University", domain: "canvas.duke.edu" },
  { name: "Northwestern University", domain: "canvas.northwestern.edu" },
  { name: "University of Washington", domain: "canvas.uw.edu" },
  { name: "UW-Madison", domain: "canvas.wisc.edu" },
  { name: "UCLA", domain: "bruinlearn.ucla.edu" },
  { name: "USC", domain: "usc.instructure.com" },
  { name: "NYU", domain: "newclasses.nyu.edu" },
  { name: "Rice University", domain: "canvas.rice.edu" },
  { name: "Purdue University", domain: "purdue.instructure.com" },
  { name: "University of Maryland", domain: "umd.instructure.com" },
  { name: "Virginia Tech", domain: "canvas.vt.edu" },
  { name: "University of Florida", domain: "ufl.instructure.com" },
  { name: "Penn State", domain: "psu.instructure.com" },
  { name: "Ohio State University", domain: "osu.instructure.com" },
  { name: "Texas A&M", domain: "canvas.tamu.edu" },
  { name: "UNC Chapel Hill", domain: "canvas.unc.edu" },
  { name: "Boston University", domain: "learn.bu.edu" },
  { name: "University of Minnesota", domain: "canvas.umn.edu" },
  { name: "Arizona State University", domain: "canvas.asu.edu" },
  { name: "CU Boulder", domain: "canvas.colorado.edu" },
  { name: "University of Virginia", domain: "canvas.virginia.edu" },
  { name: "Vanderbilt University", domain: "vanderbilt.instructure.com" },
  { name: "WashU in St. Louis", domain: "wustl.instructure.com" },
  { name: "Johns Hopkins University", domain: "jhu.instructure.com" },
  { name: "Brown University", domain: "canvas.brown.edu" },
  { name: "University of Notre Dame", domain: "nd.instructure.com" },
  { name: "UC San Diego", domain: "canvas.ucsd.edu" },
  { name: "UC Davis", domain: "canvas.ucdavis.edu" },
  { name: "UC Irvine", domain: "canvas.uci.edu" },
  { name: "UC Santa Barbara", domain: "ucsb.instructure.com" },
  { name: "Rutgers University", domain: "canvas.rutgers.edu" },
  { name: "University of Pittsburgh", domain: "canvas.pitt.edu" },
  { name: "Indiana University", domain: "iu.instructure.com" },
  { name: "Michigan State University", domain: "msu.instructure.com" },
  { name: "NC State", domain: "ncsu.instructure.com" },
  { name: "Clemson University", domain: "clemson.instructure.com" },
  { name: "Auburn University", domain: "auburn.instructure.com" },
  { name: "University of Alabama", domain: "ua.instructure.com" },
  { name: "University of Tennessee", domain: "utk.instructure.com" },
  { name: "Florida State University", domain: "canvas.fsu.edu" },
  { name: "UCF", domain: "webcourses.ucf.edu" },
  { name: "USF", domain: "usf.instructure.com" },
  { name: "UConn", domain: "uconn.instructure.com" },
  { name: "UMass Amherst", domain: "umass.instructure.com" },
  { name: "Northeastern University", domain: "northeastern.instructure.com" },
  { name: "GWU", domain: "gwu.instructure.com" },
  { name: "Georgetown University", domain: "georgetown.instructure.com" },
  { name: "Tulane University", domain: "tulane.instructure.com" },
  { name: "University of Miami", domain: "miami.instructure.com" },
  { name: "BYU", domain: "byu.instructure.com" },
  { name: "University of Utah", domain: "utah.instructure.com" },
  { name: "Colorado School of Mines", domain: "mines.instructure.com" },
  { name: "RPI", domain: "rpi.instructure.com" },
  { name: "RIT", domain: "rit.instructure.com" },
  { name: "Iowa State University", domain: "canvas.iastate.edu" },
  { name: "Oregon State University", domain: "canvas.oregonstate.edu" },
  { name: "University of Oregon", domain: "canvas.uoregon.edu" },
  { name: "Stony Brook University", domain: "stonybrook.instructure.com" },

  // Community colleges + other systems
  { name: "Maricopa Community Colleges", domain: "canvas.maricopa.edu" },
  { name: "CUNY", domain: "cuny.instructure.com" },
  { name: "SUNY", domain: "suny.instructure.com" },
];

/**
 * Search schools by name or domain.
 * Returns up to `limit` matches.
 */
export function searchSchools(query: string, limit: number = 8): CanvasSchool[] {
  if (!query) return CANVAS_SCHOOLS.slice(0, limit);

  const lower = query.toLowerCase();
  return CANVAS_SCHOOLS
    .filter((s) => s.name.toLowerCase().includes(lower) || s.domain.toLowerCase().includes(lower))
    .slice(0, limit);
}
